import { NextResponse } from "next/server";

type Job = {
  id?: string | number;
  title?: string;
  company_name?: string;
  company?: string;
  url?: string;
  created_at?: string;
  date?: string;
  tags?: string[];
  description?: string;
};

type Observation = {
  source: string;
  type: "job" | "website";
  title: string;
  category: string;
  url: string | null;
  observedAt: string;
  fingerprint?: string;
  metadata?: Record<string, string | number | boolean>;
};

const COMPANY_DOMAINS: Record<string, string> = {
  flutterwave: "flutterwave.com",
  moniepoint: "moniepoint.com",
  kora: "korapay.com",
};

const match = (j: Job, c: string) =>
  [j.company_name, j.company, j.title, j.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(c.toLowerCase());

const classifyJob = (j: Job) => {
  const t = [j.title, j.description, ...(j.tags || [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/security|cyber|soc|iam|compliance|risk/.test(t)) return "Security / compliance";
  if (/backend|platform|infrastructure|devops|site reliability|cloud|api|software engineer/.test(t))
    return "Engineering / infrastructure";
  if (/sales|business development|partnership|account executive/.test(t)) return "Commercial";
  if (/product|operations|implementation/.test(t)) return "Product / operations";
  return "Hiring";
};

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function websiteObservation(company: string): Promise<Observation | null> {
  const domain = COMPANY_DOMAINS[company.toLowerCase()];
  if (!domain) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);

  try {
    const response = await fetch("https://" + domain, {
      signal: controller.signal,
      headers: { "user-agent": "Opportunity-Intelligence/0.1 evidence-monitor" },
      next: { revalidate: 900 },
    });

    if (!response.ok) return null;

    const html = (await response.text()).slice(0, 500_000);
    const title =
      html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
        ?.replace(/\s+/g, " ")
        .trim() || company + " website";

    const normalized = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const fingerprint = await sha256(normalized);

    return {
      source: "Official website",
      type: "website",
      title,
      category: "Website / product",
      url: "https://" + domain,
      observedAt: new Date().toISOString(),
      fingerprint,
      metadata: {
        domain,
        status: response.status,
        contentLength: normalized.length,
      },
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: Request) {
  const company = new URL(request.url).searchParams.get("company")?.trim();
  if (!company)
    return NextResponse.json({ error: "company is required" }, { status: 400 });

  const observations: Observation[] = [];
  const errors: string[] = [];

  try {
    const r = await fetch(
      "https://remotive.com/api/remote-jobs?search=" + encodeURIComponent(company),
      { next: { revalidate: 900 } }
    );
    if (!r.ok) throw new Error();
    const d = await r.json();

    for (const j of (d.jobs || []) as Job[]) {
      if (match(j, company))
        observations.push({
          source: "Remotive",
          type: "job",
          title: j.title || "New hiring signal",
          category: classifyJob(j),
          url: j.url || null,
          observedAt: j.created_at || new Date().toISOString(),
        });
    }
  } catch {
    errors.push("Remotive unavailable");
  }

  try {
    const r = await fetch("https://www.arbeitnow.com/api/job-board-api", {
      next: { revalidate: 900 },
    });
    if (!r.ok) throw new Error();
    const d = await r.json();

    for (const j of (d.data || []) as Job[]) {
      if (match(j, company))
        observations.push({
          source: "Arbeitnow",
          type: "job",
          title: j.title || "New hiring signal",
          category: classifyJob(j),
          url: j.url || null,
          observedAt: j.created_at || j.date || new Date().toISOString(),
        });
    }
  } catch {
    errors.push("Arbeitnow unavailable");
  }

  const website = await websiteObservation(company);
  if (website) observations.push(website);

  const unique = Array.from(
    new Map(
      observations.map((x) => [
        x.type + "|" + String(x.url || x.title) + "|" + x.source,
        x,
      ])
    ).values()
  );

  const categories = Array.from(new Set(unique.map((x) => x.category)));
  const jobCount = unique.filter((x) => x.type === "job").length;
  const websiteCount = unique.filter((x) => x.type === "website").length;

  const signal = unique.length
    ? {
        score: Math.min(
          98,
          52 +
            Math.min(jobCount, 8) * 4 +
            Math.min(websiteCount, 1) * 7 +
            Math.max(categories.length - 1, 0) * 5
        ),
        headline:
          categories.length > 1
            ? "Multi-signal activity detected"
            : categories[0] + " activity",
        detail:
          unique.length +
          " public observation" +
          (unique.length === 1 ? "" : "s") +
          " collected across " +
          (categories.length > 1 ? categories.length + " signal categories." : "the available signal source."),
        commercialInterpretation:
          categories.includes("Engineering / infrastructure")
            ? "Potential engineering, infrastructure or delivery capacity demand"
            : categories.includes("Security / compliance")
              ? "Potential security, compliance or reliability demand"
              : categories.includes("Website / product")
                ? "Website evidence captured; persistence will determine whether a product change occurred"
                : "Potential commercial or operational demand",
      }
    : null;

  return NextResponse.json({
    company,
    monitoredAt: new Date().toISOString(),
    sources: {
      jobs: ["Remotive", "Arbeitnow"],
      website: COMPANY_DOMAINS[company.toLowerCase()] || null,
    },
    baseline: {
      observationCount: unique.length,
      categories,
      established: unique.length > 0,
    },
    signal,
    observations: unique.slice(0, 30),
    errors,
    persistence: {
      status: "not_connected",
      note: "Observations are normalized for durable historical storage, but this deployment has no database connection yet.",
    },
  });
}

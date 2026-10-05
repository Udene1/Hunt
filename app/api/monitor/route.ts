import { NextResponse } from "next/server";
import { prisma, databaseConfigured } from "@/lib/db";
import { COMPANY_CATALOG, findCompany, normalizeCompany } from "@/lib/companies";

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
  fingerprint: string;
  metadata?: Record<string, string | number | boolean>;
};

const match = (j: Job, c: string) =>
  [j.company_name, j.company, j.title, j.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(c.toLowerCase());

const classifyJob = (j: Job) => {
  const t = [j.title, j.description, ...(j.tags || [])].filter(Boolean).join(" ").toLowerCase();
  if (/security|cyber|soc|iam|compliance|risk/.test(t)) return "Security / compliance";
  if (/backend|platform|infrastructure|devops|site reliability|cloud|api|software engineer/.test(t)) return "Engineering / infrastructure";
  if (/sales|business development|partnership|account executive/.test(t)) return "Commercial";
  if (/product|operations|implementation/.test(t)) return "Product / operations";
  return "Hiring";
};

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function websiteObservation(company: string, domain: string | null): Promise<Observation | null> {
  if (!domain) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch("https://" + domain, {
      signal: controller.signal,
      headers: { "user-agent": "Opportunity-Intelligence/0.2 evidence-monitor" },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const html = (await response.text()).slice(0, 500_000);
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() || company + " website";
    const normalized = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return {
      source: "Official website",
      type: "website",
      title,
      category: "Website / product",
      url: "https://" + domain,
      observedAt: new Date().toISOString(),
      fingerprint: await sha256("website|" + domain + "|" + normalized),
      metadata: { domain, status: response.status, contentLength: normalized.length },
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function persist(
  company: string,
  domain: string | null,
  observations: Observation[],
  signal: { score: number; headline: string; detail: string; commercialInterpretation: string } | null,
  errors: string[],
) {
  if (!databaseConfigured()) {
    return { status: "not_configured", newObservationCount: 0, previousObservationCount: 0 };
  }

  const normalized = normalizeCompany(company);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const dbCompany = await tx.company.upsert({
        where: { normalized },
        update: { domain: domain || undefined },
        create: { name: company, normalized, domain },
      });
      const previousObservationCount = await tx.observation.count({ where: { companyId: dbCompany.id } });
      const run = await tx.monitoringRun.create({
        data: { companyId: dbCompany.id, status: "running" },
      });

      let newObservationCount = 0;
      for (const observation of observations) {
        const existing = await tx.observation.findUnique({
          where: { companyId_fingerprint: { companyId: dbCompany.id, fingerprint: observation.fingerprint } },
        });
        if (existing) {
          await tx.observation.update({
            where: { id: existing.id },
            data: { lastSeenAt: new Date(), observedAt: new Date(observation.observedAt), runId: run.id, metadata: observation.metadata },
          });
        } else {
          await tx.observation.create({
            data: {
              companyId: dbCompany.id,
              runId: run.id,
              source: observation.source,
              type: observation.type,
              category: observation.category,
              title: observation.title,
              url: observation.url,
              fingerprint: observation.fingerprint,
              observedAt: new Date(observation.observedAt),
              metadata: observation.metadata,
            },
          });
          newObservationCount++;
        }
      }

      if (signal) {
        await tx.signal.create({
          data: {
            companyId: dbCompany.id,
            runId: run.id,
            score: signal.score,
            headline: signal.headline,
            detail: signal.detail,
            commercialInterpretation: signal.commercialInterpretation,
          },
        });
      }

      await tx.monitoringRun.update({
        where: { id: run.id },
        data: {
          finishedAt: new Date(),
          status: errors.length ? "completed_with_errors" : "completed",
          observationCount: observations.length,
          errorCount: errors.length,
        },
      });

      return { status: "persisted", newObservationCount, previousObservationCount };
    });
    return result;
  } catch {
    return { status: "database_error", newObservationCount: 0, previousObservationCount: 0 };
  }
}

export async function GET(request: Request) {
  const rawCompany = new URL(request.url).searchParams.get("company")?.trim();
  if (!rawCompany) return NextResponse.json({ error: "company is required" }, { status: 400 });

  const seed = findCompany(rawCompany);
  const company = seed?.name || rawCompany;
  const domain = seed?.domain || null;
  const observations: Observation[] = [];
  const errors: string[] = [];

  try {
    const r = await fetch("https://remotive.com/api/remote-jobs?search=" + encodeURIComponent(company), { cache: "no-store" });
    if (!r.ok) throw new Error();
    const d = await r.json();
    for (const j of (d.jobs || []) as Job[]) {
      if (!match(j, company)) continue;
      const title = j.title || "New hiring signal";
      const url = j.url || null;
      observations.push({
        source: "Remotive",
        type: "job",
        title,
        category: classifyJob(j),
        url,
        observedAt: j.created_at || new Date().toISOString(),
        fingerprint: await sha256("job|remotive|" + title + "|" + String(url || "")),
      });
    }
  } catch {
    errors.push("Remotive unavailable");
  }

  try {
    const r = await fetch("https://www.arbeitnow.com/api/job-board-api", { cache: "no-store" });
    if (!r.ok) throw new Error();
    const d = await r.json();
    for (const j of (d.data || []) as Job[]) {
      if (!match(j, company)) continue;
      const title = j.title || "New hiring signal";
      const url = j.url || null;
      observations.push({
        source: "Arbeitnow",
        type: "job",
        title,
        category: classifyJob(j),
        url,
        observedAt: j.created_at || j.date || new Date().toISOString(),
        fingerprint: await sha256("job|arbeitnow|" + title + "|" + String(url || "")),
      });
    }
  } catch {
    errors.push("Arbeitnow unavailable");
  }

  const website = await websiteObservation(company, domain);
  if (website) observations.push(website);

  const unique = Array.from(new Map(observations.map((x) => [x.fingerprint, x])).values());
  const categories = Array.from(new Set(unique.map((x) => x.category)));
  const jobCount = unique.filter((x) => x.type === "job").length;
  const websiteCount = unique.filter((x) => x.type === "website").length;

  const signal = unique.length
    ? {
        score: Math.min(98, 52 + Math.min(jobCount, 8) * 4 + Math.min(websiteCount, 1) * 7 + Math.max(categories.length - 1, 0) * 5),
        headline: categories.length > 1 ? "Multi-signal activity detected" : categories[0] + " activity",
        detail: unique.length + " public observation" + (unique.length === 1 ? "" : "s") + " collected across " + (categories.length > 1 ? categories.length + " signal categories." : "the available signal source."),
        commercialInterpretation: categories.includes("Engineering / infrastructure")
          ? "Potential engineering, infrastructure or delivery capacity demand"
          : categories.includes("Security / compliance")
            ? "Potential security, compliance or reliability demand"
            : categories.includes("Commercial")
              ? "Potential revenue, partnership or go-to-market demand"
              : categories.includes("Product / operations")
                ? "Potential product, implementation or operational demand"
                : categories.includes("Website / product")
                  ? "Website evidence captured; persistence will determine whether a product change occurred"
                  : "Potential commercial or operational demand",
      }
    : null;

  const persistence = await persist(company, domain, unique, signal, errors);
  const changeDetected = persistence.status === "persisted"
    ? persistence.newObservationCount > 0
    : null;

  return NextResponse.json({
    company,
    monitoredAt: new Date().toISOString(),
    sources: { jobs: ["Remotive", "Arbeitnow"], website: domain },
    baseline: {
      observationCount: unique.length,
      categories,
      established: persistence.previousObservationCount > 0 || unique.length > 0,
    },
    change: {
      detected: changeDetected,
      newObservationCount: persistence.newObservationCount,
      previousObservationCount: persistence.previousObservationCount,
    },
    signal,
    observations: unique.slice(0, 30),
    errors,
    persistence: {
      status: persistence.status,
      note: persistence.status === "persisted"
        ? "Historical observations and fingerprints are now durable."
        : "Set DATABASE_URL to enable durable historical state.",
    },
  });
}

import { detectProductSurfaces, type SurfaceProbe } from "./product-surfaces";
import { githubAdapter } from "./github-signals";
import { collectCompanyPeopleAndFinance, type DiscoveredContact, type DiscoveredFinancialRecord } from "./company-people-finance";

export type Observation = {
  source: string;
  type: "job" | "website" | "product" | "technology" | "security" | "funding" | "leadership" | "regulatory" | "procurement" | "partnership" | "location";
  title: string;
  category: string;
  url: string | null;
  observedAt: string;
  fingerprint: string;
  metadata?: Record<string, string | number | boolean>;
};

export type SignalAdapterResult = {
  observations: Observation[];
  errors: string[];
  probes?: SurfaceProbe[];
  contacts?: DiscoveredContact[];
  financials?: DiscoveredFinancialRecord[];
};

export type SignalAdapter = {
  id: string;
  collect(company: string, domain: string | null): Promise<SignalAdapterResult>;
};

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Job = {
  title?: string;
  company_name?: string;
  company?: string;
  url?: string;
  created_at?: string;
  date?: string;
  tags?: string[];
  description?: string;
};

const match = (j: Job, company: string) =>
  [j.company_name, j.company, j.title, j.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(company.toLowerCase());

const classifyJob = (j: Job) => {
  const title = (j.title || "").toLowerCase().trim();
  const text = [j.title, j.description, ...(j.tags || [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  // Titles are the strongest role signal. Avoid broad description keywords
  // such as "risk" or "security" hijacking unrelated research/engineering roles.
  if (/quantum|quantum information|quantum computing|quantum scientist|quantum engineer/.test(title)) {
    return "Research / quantum";
  }
  if (/security engineer|cybersecurity|security analyst|soc analyst|information security|iam|identity|compliance officer|compliance manager|risk manager/.test(title)) {
    return "Security / compliance";
  }
  if (/backend|platform|infrastructure|devops|site reliability|cloud|api|software engineer/.test(title)) {
    return "Engineering / infrastructure";
  }
  if (/sales|business development|partnership|account executive/.test(title)) {
    return "Commercial";
  }
  if (/product|operations|implementation/.test(title)) {
    return "Product / operations";
  }
  if (/data scientist|data analyst|analytics|machine learning|ml engineer|ai engineer/.test(title)) {
    return "Data / AI";
  }
  if (/research scientist|research engineer|research/.test(title)) {
    return "Research";
  }

  // Only use description corroboration when the title itself is generic.
  if (/security|cybersecurity|soc|iam|identity|compliance/.test(text)) {
    return "Security / compliance";
  }
  if (/backend|platform|infrastructure|devops|site reliability|cloud|api|software engineer/.test(text)) {
    return "Engineering / infrastructure";
  }
  if (/sales|business development|partnership|account executive/.test(text)) {
    return "Commercial";
  }
  if (/product|operations|implementation/.test(text)) {
    return "Product / operations";
  }
  if (/quantum/.test(text)) {
    return "Research / quantum";
  }
  if (/data scientist|data analyst|analytics|machine learning|ml engineer|ai engineer/.test(text)) {
    return "Data / AI";
  }
  if (/research scientist|research engineer|research/.test(text)) {
    return "Research";
  }
  return "Hiring";
};

// Job boards are an adapter, not the Hunt product. Their observations enter the
// same evidence pipeline as every future signal family.
const jobAdapter: SignalAdapter = {
  id: "jobs",
  async collect(company) {
    const observations: Observation[] = [];
    const errors: string[] = [];

    for (const source of [
      { name: "Remotive", url: "https://remotive.com/api/remote-jobs?search=" + encodeURIComponent(company), list: "jobs" },
      { name: "Arbeitnow", url: "https://www.arbeitnow.com/api/job-board-api", list: "data" },
    ]) {
      try {
        const response = await fetch(source.url, { cache: "no-store" });
        if (!response.ok) throw new Error();
        const data = await response.json();
        for (const job of (data[source.list] || []) as Job[]) {
          if (!match(job, company)) continue;
          const title = job.title || "New hiring signal";
          const url = job.url || null;
          observations.push({
            source: source.name,
            type: "job",
            title,
            category: classifyJob(job),
            url,
            observedAt: job.created_at || job.date || new Date().toISOString(),
            fingerprint: await sha256("job|" + source.name.toLowerCase() + "|" + title + "|" + String(url || "")),
          });
        }
      } catch {
        errors.push(source.name + " unavailable");
      }
    }

    return { observations, errors };
  },
};

const websiteAdapter: SignalAdapter = {
  id: "official-website",
  async collect(company, domain) {
    if (!domain) return { observations: [], errors: [] };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);

    try {
      const response = await fetch("https://" + domain, {
        signal: controller.signal,
        headers: { "user-agent": "Opportunity-Intelligence/0.2 evidence-monitor" },
        cache: "no-store",
      });
      if (!response.ok) return { observations: [], errors: ["Official website unavailable"] };

      const html = (await response.text()).slice(0, 500_000);
      const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() || company + " website";
      const normalized = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      return {
        observations: [{
          source: "Official website",
          type: "website",
          title,
          category: "Website / product",
          url: "https://" + domain,
          observedAt: new Date().toISOString(),
          fingerprint: await sha256("website|" + domain + "|" + normalized),
          metadata: { domain, status: response.status, contentLength: normalized.length },
        }],
        errors: [],
      };
    } catch {
      return { observations: [], errors: ["Official website unavailable"] };
    } finally {
      clearTimeout(timeout);
    }
  },
};

const procurementAdapter: SignalAdapter = {
  id: "procurement",
  async collect(company) {
    const observations: Observation[] = [];
    const errors: string[] = [];
    const search = encodeURIComponent(company);
    const pages = [
      "https://www.etenders.com.ng/?s=" + search,
      "https://www.etenders.com.ng/",
      "https://www.etenders.com.ng/page/2/",
      "https://www.etenders.com.ng/page/3/",
    ];

    for (const page of pages) {
      try {
        const response = await fetch(page, {
          cache: "no-store",
          headers: { "user-agent": "Opportunity-Intelligence/0.2 evidence-monitor" },
        });
        if (!response.ok) throw new Error();

        const html = await response.text();
        const anchors = Array.from(
          html.matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi),
        );

        for (const match of anchors) {
          const title = match[2]
            .replace(/<[^>]+>/g, " ")
            .replace(/&nbsp;/gi, " ")
            .replace(/&amp;/gi, "&")
            .replace(/&raquo;/gi, " ")
            .replace(/\s+/g, " ")
            .trim()
            .replace(/\s*(?:read more|»)+\s*$/i, "")
            .trim();
          if (!title || !title.toLowerCase().includes(company.toLowerCase())) continue;

          const url = match[1].startsWith("http")
            ? match[1]
            : new URL(match[1], page).toString();
          observations.push({
            source: "eTenders Nigeria",
            type: "procurement",
            title,
            category: "Procurement",
            url,
            observedAt: new Date().toISOString(),
            fingerprint: await sha256("procurement|etenders|" + url),
          });
        }
      } catch {
        errors.push("eTenders unavailable");
        break;
      }
    }

    return {
      observations: Array.from(new Map(observations.map((item) => [item.fingerprint, item])).values()),
      errors: Array.from(new Set(errors)),
    };
  },
};

const technologyAdapter: SignalAdapter = {
  id: "technology",
  async collect(company, domain) {
    if (!domain) return { observations: [], errors: [] };

    const observations: Observation[] = [];
    const errors: string[] = [];
    const normalizedDomain = domain.toLowerCase().replace(/^www\./, "");
    const hostnames = new Set<string>();
    let sourceUsed = "";

    const collectNames = (names: string[]) => {
      for (const rawName of names) {
        const hostname = rawName.trim().toLowerCase().replace(/^\*\./, "");
        if (
          hostname &&
          hostname !== normalizedDomain &&
          hostname.endsWith("." + normalizedDomain)
        ) {
          hostnames.add(hostname);
        }
      }
    };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 7000);
      try {
        const response = await fetch(
          "https://crt.sh/?q=" + encodeURIComponent("%." + normalizedDomain) + "&output=json",
          {
            signal: controller.signal,
            cache: "no-store",
            headers: { "user-agent": "Opportunity-Intelligence/0.2 evidence-monitor" },
          },
        );
        if (!response.ok) throw new Error("crt.sh unavailable");

        const records = await response.json() as Array<{ name_value?: string }>;
        collectNames(records.flatMap((record) => (record.name_value || "").split("\n")));
        sourceUsed = "crt.sh";
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 7000);
        try {
          const response = await fetch(
            "https://api.certspotter.com/v1/issuances?domain=" +
              encodeURIComponent(normalizedDomain) +
              "&include_subdomains=true&expand=dns_names",
            {
              signal: controller.signal,
              cache: "no-store",
              headers: { "user-agent": "Opportunity-Intelligence/0.2 evidence-monitor" },
            },
          );
          if (!response.ok) throw new Error("Cert Spotter unavailable");

          const records = await response.json() as Array<{ dns_names?: string[] }>;
          collectNames(records.flatMap((record) => record.dns_names || []));
          sourceUsed = "Cert Spotter";
        } finally {
          clearTimeout(timeout);
        }
      } catch {
        errors.push("Certificate Transparency unavailable");
      }
    }

    for (const hostname of Array.from(hostnames)) {
      observations.push({
        source: "Certificate Transparency (" + sourceUsed + ")",
        type: "technology",
        title: "Public certificate hostname: " + hostname,
        category: "Technology / infrastructure",
        url: "https://" + hostname,
        observedAt: new Date().toISOString(),
        fingerprint: await sha256("technology|ct-hostname|" + hostname),
        metadata: { hostname, domain: normalizedDomain, source: sourceUsed },
      });
    }

    return {
      observations: Array.from(
        new Map(observations.map((item) => [item.fingerprint, item])).values(),
      ),
      errors,
    };
  },
};

const peopleFinanceAdapter: SignalAdapter = {
  id: "people-finance",
  async collect(company, domain) {
    const result = await collectCompanyPeopleAndFinance(company, domain);
    return { observations: result.observations, errors: result.errors, contacts: result.contacts, financials: result.financials };
  },
};

const productSurfaceAdapter: SignalAdapter = {
  id: "product-surfaces",
  async collect(company, domain) {
    if (!domain) return { observations: [], errors: [] };
    return detectProductSurfaces(domain);
  },
};

export const SIGNAL_ADAPTERS: SignalAdapter[] = [
  jobAdapter,
  websiteAdapter,
  procurementAdapter,
  technologyAdapter,
  productSurfaceAdapter,
  githubAdapter,
  peopleFinanceAdapter,
];

export async function collectObservations(company: string, domain: string | null) {
  const results = await Promise.all(SIGNAL_ADAPTERS.map((adapter) => adapter.collect(company, domain)));
  return {
    adapters: SIGNAL_ADAPTERS.map((adapter) => adapter.id),
    observations: results.flatMap((result) => result.observations),
    errors: results.flatMap((result) => result.errors),
    probes: results.flatMap((result) => result.probes || []),
    contacts: results.flatMap((result) => result.contacts || []),
    financials: results.flatMap((result) => result.financials || []),
  };
}

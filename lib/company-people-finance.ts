import type { Observation } from "./signal-adapters";

export type DiscoveredContact = {
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  source: string;
  sourceUrl: string | null;
  evidenceFingerprint: string | null;
  confidence: number;
};

export type DiscoveredFinancialRecord = {
  period: string;
  statementType: string;
  currency: string | null;
  source: string;
  sourceUrl: string;
  publishedAt: string | null;
  summary: string | null;
  metrics: Record<string, string | number | boolean> | null;
  evidenceFingerprint: string;
  confidence: number;
};

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function clean(value: string) {
  return value.replace(/\s+/g, " ").replace(/&amp;/gi, "&").replace(/&nbsp;/gi, " ").trim();
}

function extractJsonLd(html: string) {
  const values: unknown[] = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1]);
      values.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch {}
  }
  return values;
}

function personNodes(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(personNodes);
  const object = value as Record<string, unknown>;
  const graph = Array.isArray(object["@graph"]) ? object["@graph"] : [];
  return [object, ...graph.flatMap(personNodes)].filter((item) => {
    const type = item["@type"];
    return typeof type === "string" ? /person/i.test(type) : Array.isArray(type) && type.some((x) => /person/i.test(String(x)));
  });
}

function findEmail(text: string) {
  return text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || null;
}

function findPhone(text: string) {
  return text.match(/(?:\+234|0)[0-9][\d\s().-]{7,}/)?.[0]?.replace(/\s+/g, " ") || null;
}

const contactPaths = ["/about", "/about-us", "/team", "/leadership", "/management", "/company", "/contact"];

export async function collectCompanyPeopleAndFinance(company: string, domain: string | null) {
  const contacts = new Map<string, DiscoveredContact>();
  const financials = new Map<string, DiscoveredFinancialRecord>();
  const observations: Observation[] = [];
  const errors: string[] = [];
  if (!domain) return { contacts: [], financials: [], observations, errors };

  const root = "https://" + domain;
  const pages = new Set([root, ...contactPaths.map((path) => root + path)]);

  for (const url of pages) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        cache: "no-store",
        headers: { "user-agent": "Opportunity-Intelligence/0.2 evidence-monitor" },
      });
      if (!response.ok) continue;
      const html = (await response.text()).slice(0, 700_000);

      for (const node of extractJsonLd(html).flatMap(personNodes)) {
        const name = typeof node.name === "string" ? clean(node.name) : "";
        if (!name || name.length < 3 || name.length > 120) continue;
        const role = typeof node.jobTitle === "string" ? clean(node.jobTitle) : null;
        const email = typeof node.email === "string" ? node.email.replace(/^mailto:/i, "").trim() : null;
        const phone = typeof node.telephone === "string" ? clean(node.telephone) : null;
        const sameAs = Array.isArray(node.sameAs) ? node.sameAs.map(String) : [];
        const linkedinUrl = sameAs.find((item) => /linkedin\.com\//i.test(item)) || null;
        const key = name.toLowerCase() + "|" + (role || "").toLowerCase();
        contacts.set(key, {
          name, role, email, phone, linkedinUrl,
          source: "Official website",
          sourceUrl: url,
          evidenceFingerprint: null,
          confidence: 82,
        });
      }

      const text = clean(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
      const email = findEmail(text);
      const phone = findPhone(text);
      if (email || phone) {
        const name = email?.split("@")[0]?.replace(/[._-]+/g, " ") || company + " contact";
        const key = name.toLowerCase() + "|contact";
        if (!contacts.has(key)) contacts.set(key, {
          name: clean(name), role: "Public contact", email, phone, linkedinUrl: null,
          source: "Official website", sourceUrl: url, evidenceFingerprint: null, confidence: 55,
        });
      }

      const anchors = Array.from(html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi));
      for (const match of anchors) {
        const label = clean(match[2].replace(/<[^>]+>/g, " "));
        const href = match[1].startsWith("http") ? match[1] : new URL(match[1], url).toString();
        const financial = /(annual report|financial statement|financials|results|investor relations|investor report|accounts|report and accounts)/i.test(label + " " + href);
        if (!financial || !/\.pdf(?:$|[?#])/i.test(href) && !/annual|financial|results|investor|accounts/i.test(href)) continue;
        const period = (label + " " + href).match(/20\d{2}(?:[-/]20\d{2})?/)?.[0] || "latest";
        const statementType = /quarter|q[1-4]/i.test(label + href) ? "quarterly" : /results/i.test(label) ? "results" : "annual";
        const fingerprint = await sha256("financial|" + href);
        financials.set(href, {
          period, statementType, currency: /ngn|naira|₦/i.test(label + href) ? "NGN" : null,
          source: "Official website", sourceUrl: href, publishedAt: null,
          summary: label || "Financial report",
          metrics: null, evidenceFingerprint: fingerprint, confidence: 88,
        });
        observations.push({
          source: "Official website",
          type: "funding",
          title: "Financial report: " + (label || period),
          category: "Financial / reporting",
          url: href,
          observedAt: new Date().toISOString(),
          fingerprint,
          metadata: { period, statementType, company, financialDocument: true },
        });
      }
    } catch {
      // Individual pages are optional evidence surfaces; do not fail the company scan.
    } finally {
      clearTimeout(timeout);
    }
  }

  return { contacts: Array.from(contacts.values()), financials: Array.from(financials.values()), observations, errors };
}

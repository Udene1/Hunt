type Observation = {
  source: string;
  type: "business" | "funding" | "insurance" | "legal" | "financial" | "location" | "partnership" | "procurement" | "regulatory";
  title: string;
  category: string;
  url: string | null;
  observedAt: string;
  fingerprint: string;
  metadata?: Record<string, string | number | boolean>;
};
type SignalAdapterResult = { observations: Observation[]; errors: string[] };
type SignalAdapter = { id: string; collect(company: string, domain: string | null): Promise<SignalAdapterResult> };

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function decodeHtml(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
}
function clean(value: string) {
  return decodeHtml(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function absolute(base: string, href: string) {
  try { return new URL(decodeHtml(href), base).toString(); } catch { return null; }
}
function originalResultUrl(href: string) {
  const resolved = absolute("https://html.duckduckgo.com", href);
  if (!resolved) return null;
  try {
    const parsed = new URL(resolved);
    // DuckDuckGo's HTML results wrap the actual destination in uddg. Never store
    // the search redirect as if it were the original source evidence.
    const target = parsed.searchParams.get("uddg");
    const unwrapped = target ? new URL(target) : parsed;
    if (unwrapped.protocol !== "https:" && unwrapped.protocol !== "http:") return null;
    if (/^(?:www\.)?(?:duckduckgo\.com|html\.duckduckgo\.com)$/i.test(unwrapped.hostname)) return null;
    if (/facebook\.com$|(^|\.)x\.com$|twitter\.com$|youtube\.com$|tiktok\.com$|instagram\.com$/i.test(unwrapped.hostname)) return null;
    unwrapped.hash = "";
    return unwrapped.toString();
  } catch { return null; }
}
function companyMentioned(text: string, company: string, domain: string | null, url: string) {
  const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const target = normalized(company);
  const haystack = normalized(text);
  const tokens = company.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 4);
  let hostMatches = false;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const expected = (domain || "").toLowerCase().replace(/^www\./, "");
    hostMatches = Boolean(expected && (host === expected || host.endsWith("." + expected)));
  } catch {}
  return hostMatches || (target.length >= 5 && haystack.includes(target)) ||
    (tokens.length > 0 && tokens.every((token) => haystack.includes(token)));
}
const families = [
  { id: "funding", type: "funding" as const, category: "Funding / investment", terms: "funding investment financing capital raise acquisition acquired investor" },
  { id: "expansion", type: "location" as const, category: "Expansion / location", terms: "expansion new plant new facility new office warehouse factory launch market entry" },
  { id: "relationships", type: "partnership" as const, category: "Supplier / customer / partnership", terms: "supplier customer client contract partnership selected vendor strategic alliance" },
  { id: "insurance", type: "insurance" as const, category: "Insurance / risk", terms: "insurance insured underwriting risk coverage claim liability broker" },
  { id: "legal", type: "legal" as const, category: "Legal / dispute", terms: "lawsuit litigation court arbitration judgment dispute investigation" },
  { id: "financial", type: "financial" as const, category: "Financial reporting", terms: "annual report financial results revenue profit assets debt accounts" },
  { id: "business", type: "business" as const, category: "Business / operations", terms: "operations production capacity distribution logistics manufacturing project commercial strategy" },
];

export const publicEvidenceDiscoveryAdapter: SignalAdapter = {
  id: "public-evidence-discovery",
  async collect(company, domain) {
    const observations: Observation[] = [];
    const errors: string[] = [];
    await Promise.all(families.map(async (family) => {
      const query = '"' + company.replace(/"/g, "") + '" ' + family.terms;
      const searchUrl = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      try {
        const response = await fetch(searchUrl, {
          signal: controller.signal,
          cache: "no-store",
          headers: { "user-agent": "Hunt-Opportunity-Intelligence/1.0 (+public evidence research)" },
        });
        if (!response.ok) throw new Error("search_http_" + response.status);
        const html = (await response.text()).slice(0, 700000);
        // Parse the result anchor itself, then unwrap DuckDuckGo's uddg parameter.
        const resultPattern = /<a\b[^>]*class=["'][^"']*\bresult__a\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        const candidates: Array<{ url: string; title: string }> = [];
        for (const match of html.matchAll(resultPattern)) {
          const url = originalResultUrl(match[1]);
          const title = clean(match[2]).slice(0, 220);
          if (!url || !title) continue;
          if (candidates.some((candidate) => candidate.url === url)) continue;
          candidates.push({ url, title });
          if (candidates.length >= 3) break;
        }

        // A search-result link alone is not proof. Fetch the original page and
        // retain it only if it responds and its title/body ties it to this company.
        const checked = await Promise.all(candidates.map(async (candidate) => {
          const pageController = new AbortController();
          const pageTimeout = setTimeout(() => pageController.abort(), 4500);
          try {
            const page = await fetch(candidate.url, {
              signal: pageController.signal,
              cache: "no-store",
              redirect: "follow",
              headers: { "user-agent": "Hunt-Opportunity-Intelligence/1.0 (+public evidence research)", accept: "text/html,application/xhtml+xml" },
            });
            if (!page.ok) return null;
            const contentType = page.headers.get("content-type") || "";
            if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) return null;
            const body = (await page.text()).slice(0, 500000);
            const pageTitle = clean(body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || candidate.title).slice(0, 220);
            const text = clean(body).slice(0, 120000);
            if (!companyMentioned(pageTitle + " " + text, company, domain, page.url || candidate.url)) return null;
            let excerpt = text;
            const companyIndex = text.toLowerCase().indexOf(company.toLowerCase());
            if (companyIndex >= 0) excerpt = text.slice(Math.max(0, companyIndex - 180), companyIndex + 420);
            else excerpt = text.slice(0, 500);
            return {
              url: page.url || candidate.url,
              title: pageTitle || candidate.title,
              excerpt: excerpt.slice(0, 600),
              status: page.status,
            };
          } catch {
            return null;
          } finally {
            clearTimeout(pageTimeout);
          }
        }));
        for (const page of checked) {
          if (!page) continue;
          observations.push({
            source: "Public web evidence (page fetched)",
            type: family.type,
            title: page.title,
            category: family.category,
            url: page.url,
            observedAt: new Date().toISOString(),
            fingerprint: await sha256("public-web|" + family.id + "|" + page.url),
            metadata: {
              company,
              family: family.id,
              query,
              domain: domain || "",
              sourceTier: "secondary",
              evidenceType: "fetched_source_page",
              pageStatus: page.status,
              excerpt: page.excerpt,
              companyAssociationChecked: true,
            },
          });
        }
        if (checked.length === 0 || checked.every((item) => item === null)) {
          errors.push(family.id + " yielded no fetched page with a verifiable company association");
        }
      } catch (error) {
        errors.push(family.id + " public discovery unavailable" + (error instanceof Error && error.message.startsWith("search_http_") ? " (" + error.message + ")" : ""));
      } finally {
        clearTimeout(timeout);
      }
    }));
    return {
      observations: Array.from(new Map(observations.map((observation) => [observation.fingerprint, observation])).values()),
      errors: Array.from(new Set(errors)),
    };
  },
};

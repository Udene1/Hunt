type Observation = {
  source: string;
  type: "business" | "funding" | "insurance" | "legal" | "financial" | "location" | "partnership" | "procurement" | "regulatory";
  title: string; category: string; url: string | null; observedAt: string; fingerprint: string;
  metadata?: Record<string, string | number | boolean>;
};
type SignalAdapterResult = { observations: Observation[]; errors: string[] };
type SignalAdapter = { id: string; collect(company: string, domain: string | null): Promise<SignalAdapterResult> };

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function clean(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}
function absolute(base: string, href: string) { try { return new URL(href, base).toString(); } catch { return null; } }
const families = [
  { id:"funding", type:"funding" as const, category:"Funding / investment", terms:"funding investment financing capital raise acquisition acquired investor" },
  { id:"expansion", type:"location" as const, category:"Expansion / location", terms:"expansion new plant new facility new office warehouse factory launch market entry" },
  { id:"relationships", type:"partnership" as const, category:"Supplier / customer / partnership", terms:"supplier customer client contract partnership selected vendor strategic alliance" },
  { id:"insurance", type:"insurance" as const, category:"Insurance / risk", terms:"insurance insured underwriting risk coverage claim liability broker" },
  { id:"legal", type:"legal" as const, category:"Legal / dispute", terms:"lawsuit litigation court arbitration judgment dispute investigation" },
  { id:"financial", type:"financial" as const, category:"Financial reporting", terms:"annual report financial results revenue profit assets debt accounts" },
  { id:"business", type:"business" as const, category:"Business / operations", terms:"operations production capacity distribution logistics manufacturing project commercial strategy" },
];
function blocked(url: string) {
  try { return /(^|\\.)facebook\\.com$|(^|\\.)x\\.com$|(^|\\.)twitter\\.com$|(^|\\.)youtube\\.com$|(^|\\.)tiktok\\.com$/i.test(new URL(url).hostname); } catch { return true; }
}
export const publicEvidenceDiscoveryAdapter: SignalAdapter = {
  id:"public-evidence-discovery",
  async collect(company, domain) {
    const observations: Observation[] = []; const errors: string[] = [];
    for (const family of families) {
      const query = '"' + company.replace(/"/g, "") + '" ' + family.terms;
      const searchUrl = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query);
      const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 7000);
      try {
        const response = await fetch(searchUrl, { signal: controller.signal, cache:"no-store", headers:{ "user-agent":"Opportunity-Intelligence/0.5 evidence-discovery" } });
        if (!response.ok) throw new Error();
        const html = (await response.text()).slice(0, 900000);
        const resultPattern = new RegExp("result__a[^>]*href=[\\\"']([^\\\"']+)[\\\"'][^>]*>([\\\\s\\\\S]*?)</a>", "gi");
        const results = Array.from(html.matchAll(resultPattern));
        for (const match of results.slice(0, 6)) {
          const href = absolute("https://html.duckduckgo.com", match[1]); if (!href || blocked(href)) continue;
          const title = clean(match[2]).slice(0, 220); if (!title) continue;
          observations.push({
            source:"Public web discovery", type:family.type, title, category:family.category, url:href,
            observedAt:new Date().toISOString(), fingerprint:await sha256("public-web|" + family.id + "|" + href),
            metadata:{ company, family:family.id, query, domain:domain || "", sourceTier:"secondary", evidenceType:"search_result" },
          });
        }
      } catch { errors.push(family.id + " public discovery unavailable"); }
      finally { clearTimeout(timeout); }
    }
    return { observations:Array.from(new Map(observations.map((o) => [o.fingerprint, o])).values()), errors:Array.from(new Set(errors)) };
  },
};

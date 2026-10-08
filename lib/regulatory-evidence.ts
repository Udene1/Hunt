type Observation = {
  source: string;
  type: "regulatory";
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
function clean(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/\\s+/g, " ").trim();
}
function absolute(base: string, href: string) { try { return new URL(href, base).toString(); } catch { return null; } }

const regulators = [
  { name:"SEC Nigeria", domain:"sec.gov.ng" },
  { name:"CAC Nigeria", domain:"cac.gov.ng" },
  { name:"CBN Nigeria", domain:"cbn.gov.ng" },
  { name:"NDPC Nigeria", domain:"ndpc.gov.ng" },
  { name:"NITDA Nigeria", domain:"nitda.gov.ng" },
  { name:"FCCPC Nigeria", domain:"fccpc.gov.ng" },
];

export const authoritativeRegulatoryEvidenceAdapter: SignalAdapter = {
  id:"authoritative-regulatory-evidence",
  async collect(company) {
    const observations: Observation[] = []; const errors: string[] = [];
    for (const regulator of regulators) {
      const query = 'site:' + regulator.domain + ' "' + company.replace(/"/g, "") + '"';
      const searchUrl = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query);
      const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 7000);
      try {
        const response = await fetch(searchUrl, { signal:controller.signal, cache:"no-store", headers:{ "user-agent":"Opportunity-Intelligence/0.5 regulatory-evidence" } });
        if (!response.ok) throw new Error();
        const html = (await response.text()).slice(0, 900000);
        const results = Array.from(html.matchAll(/<a[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\\/a>/gi));
        for (const match of results.slice(0, 5)) {
          const href = absolute("https://html.duckduckgo.com", match[1]); if (!href) continue;
          let host = ""; try { host = new URL(href).hostname.toLowerCase(); } catch { continue; }
          if (!(host === regulator.domain || host.endsWith("." + regulator.domain))) continue;
          const title = clean(match[2]).slice(0, 240); if (!title) continue;
          observations.push({
            source:regulator.name, type:"regulatory", title:"Regulatory evidence: " + title, category:"Regulatory / compliance",
            url:href, observedAt:new Date().toISOString(),
            fingerprint:await sha256("regulatory|" + regulator.name + "|" + href),
            metadata:{ company, regulator:regulator.name, sourceTier:"authoritative", query, evidenceType:"regulator_search_result" },
          });
        }
      } catch { errors.push(regulator.name + " unavailable"); }
      finally { clearTimeout(timeout); }
    }
    return { observations:Array.from(new Map(observations.map((o) => [o.fingerprint, o])).values()), errors:Array.from(new Set(errors)) };
  },
};

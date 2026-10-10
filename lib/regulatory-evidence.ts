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
function decodeHtml(value: string) {
  return value
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, " ");
}
function clean(value: string) {
  return decodeHtml(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function unwrapResult(href: string) {
  try {
    const resolved = new URL(decodeHtml(href), "https://html.duckduckgo.com");
    const target = resolved.searchParams.get("uddg");
    const url = target ? new URL(target) : resolved;
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (/duckduckgo\.com$/i.test(url.hostname)) return null;
    url.hash = "";
    return url.toString();
  } catch { return null; }
}
function isOfficialHost(url: string, domain: string) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return host === domain || host.endsWith("." + domain);
  } catch { return false; }
}
function mentionsCompany(text: string, company: string) {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const normalizedCompany = normalize(company);
  const normalizedText = normalize(text);
  if (normalizedCompany.length >= 5 && normalizedText.includes(normalizedCompany)) return true;
  const meaningfulTokens = company.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 4);
  return meaningfulTokens.length > 0 && meaningfulTokens.every((token) => text.toLowerCase().includes(token));
}

const regulators = [
  { name: "SEC Nigeria", domain: "sec.gov.ng" },
  { name: "CAC Nigeria", domain: "cac.gov.ng" },
  { name: "CBN Nigeria", domain: "cbn.gov.ng" },
  { name: "NDPC Nigeria", domain: "ndpc.gov.ng" },
  { name: "NITDA Nigeria", domain: "nitda.gov.ng" },
  { name: "FCCPC Nigeria", domain: "fccpc.gov.ng" },
];

export const authoritativeRegulatoryEvidenceAdapter: SignalAdapter = {
  id: "authoritative-regulatory-evidence",
  async collect(company) {
    const observations: Observation[] = [];
    const errors: string[] = [];
    await Promise.all(regulators.map(async (regulator) => {
      const query = 'site:' + regulator.domain + ' "' + company.replace(/"/g, "") + '"';
      const searchUrl = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      try {
        const response = await fetch(searchUrl, {
          signal: controller.signal,
          cache: "no-store",
          headers: { "user-agent": "Hunt-Opportunity-Intelligence/1.0 regulatory evidence" },
        });
        if (!response.ok) throw new Error("search_http_" + response.status);
        const html = (await response.text()).slice(0, 700000);
        const resultPattern = /<a\b[^>]*class=["'][^"']*\bresult__a\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        const candidates: Array<{ url: string; title: string }> = [];
        for (const match of Array.from(html.matchAll(resultPattern))) {
          const url = unwrapResult(match[1]);
          const title = clean(match[2]).slice(0, 220);
          if (!url || !title || !isOfficialHost(url, regulator.domain)) continue;
          if (candidates.some((candidate) => candidate.url === url)) continue;
          candidates.push({ url, title });
          if (candidates.length >= 4) break;
        }

        const checked = await Promise.all(candidates.map(async (candidate) => {
          const pageController = new AbortController();
          const pageTimeout = setTimeout(() => pageController.abort(), 4500);
          try {
            const page = await fetch(candidate.url, {
              signal: pageController.signal,
              cache: "no-store",
              redirect: "follow",
              headers: { "user-agent": "Hunt-Opportunity-Intelligence/1.0 regulatory evidence", accept: "text/html,application/xhtml+xml,application/pdf,text/plain" },
            });
            if (!page.ok || !isOfficialHost(page.url || candidate.url, regulator.domain)) return null;
            const contentType = page.headers.get("content-type") || "";
            if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml") && !contentType.includes("text/plain")) return null;
            const body = (await page.text()).slice(0, 500000);
            const pageTitle = clean(body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || candidate.title).slice(0, 220);
            const text = clean(body).slice(0, 100000);
            if (!mentionsCompany(pageTitle + " " + text, company)) return null;
            const at = text.toLowerCase().indexOf(company.toLowerCase());
            const excerpt = at >= 0 ? text.slice(Math.max(0, at - 150), at + 450) : text.slice(0, 450);
            return { url: page.url || candidate.url, title: pageTitle || candidate.title, excerpt: excerpt.slice(0, 600), status: page.status };
          } catch {
            return null;
          } finally {
            clearTimeout(pageTimeout);
          }
        }));

        for (const page of checked) {
          if (!page) continue;
          observations.push({
            source: regulator.name,
            type: "regulatory",
            title: "Regulatory evidence: " + page.title,
            category: "Regulatory / compliance",
            url: page.url,
            observedAt: new Date().toISOString(),
            fingerprint: await sha256("regulatory|" + regulator.name + "|" + page.url),
            metadata: {
              company,
              regulator: regulator.name,
              sourceTier: "authoritative",
              query,
              evidenceType: "fetched_official_regulator_page",
              pageStatus: page.status,
              excerpt: page.excerpt,
              companyAssociationChecked: true,
            },
          });
        }
        if (!checked.some(Boolean)) errors.push(regulator.name + " yielded no fetched official page with a verifiable company association");
      } catch (error) {
        errors.push(regulator.name + " unavailable" + (error instanceof Error && error.message.startsWith("search_http_") ? " (" + error.message + ")" : ""));
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

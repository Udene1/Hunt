import { findCompany } from "./companies";

function normalizeToken(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function scoreCandidate(company: string, title: string, url: string) {
  const tokens = normalizeToken(company).split(" ").filter((token) => token.length >= 3);
  const normalizedTitle = normalizeToken(title);
  let hostname = "";
  try { hostname = normalizeToken(new URL(url).hostname.replace(/^www\\./i, "")); } catch { return 0; }
  const titleMatches = tokens.filter((token) => normalizedTitle.includes(token)).length;
  const hostMatches = tokens.filter((token) => hostname.includes(token)).length;
  // A name match in a search-result title is not enough: require the candidate
  // hostname to share a meaningful company token as well.
  if (titleMatches === 0 || hostMatches === 0) return 0;
  let score = titleMatches * 3 + hostMatches * 2;
  if (/\\.ng$/i.test(hostname)) score += 1;
  if (/\\b(bank|group|foods|food|holdings|plc|limited|ltd)\\b/i.test(title)) score += 1;
  return score;
}

export async function discoverCompanyDomain(company: string) {
  const seed = findCompany(company);
  if (seed) return { name: seed.name, domain: seed.domain, source: "catalogue" as const };

  const query = encodeURIComponent(company + " Nigeria official website");
  const url = "https://html.duckduckgo.com/html/?q=" + query;

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { "user-agent": "Opportunity-Intelligence/0.2 company-discovery" },
    });
    if (!response.ok) return { name: company, domain: null, source: "search" as const };

    const html = await response.text();
    const results: Array<{ title: string; href: string; score: number }> = [];
    const anchors = Array.from(html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi));

    for (const match of anchors) {
      const rawHref = match[1];
      const title = match[2].replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
      let href = rawHref;
      try {
        const parsed = new URL(rawHref, url);
        const redirected = parsed.searchParams.get("uddg");
        if (redirected) href = redirected;
      } catch {
        continue;
      }

      try {
        const parsed = new URL(href);
        if (!/^https?:$/.test(parsed.protocol)) continue;
        const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
        if (/^(facebook|instagram|linkedin|x|twitter|youtube|wikipedia)\./i.test(host)) continue;
        if (/duckduckgo\./i.test(host)) continue;
        const score = scoreCandidate(company, title, parsed.href);
        if (score >= 4) results.push({ title, href: "https://" + host, score });
      } catch {
        // Ignore malformed search results.
      }
    }

    results.sort((a, b) => b.score - a.score);
    const best = results[0];
    return best
      ? { name: company, domain: new URL(best.href).hostname, source: "search" as const }
      : { name: company, domain: null, source: "search" as const };
  } catch {
    return { name: company, domain: null, source: "search" as const };
  }
}

import { findCompany } from "./companies";

function normalizeToken(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function clean(value: string) {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function originalResultUrl(href: string) {
  try {
    const parsed = new URL(href, "https://html.duckduckgo.com");
    const target = parsed.searchParams.get("uddg");
    const url = target ? new URL(target) : parsed;
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (/duckduckgo\.com$/i.test(url.hostname)) return null;
    if (/facebook\.com$|instagram\.com$|linkedin\.com$|(^|\.)x\.com$|twitter\.com$|youtube\.com$|wikipedia\.org$/i.test(url.hostname)) return null;
    url.hash = "";
    return url.toString();
  } catch { return null; }
}
function scoreCandidate(company: string, title: string, url: string) {
  const tokens = normalizeToken(company).split(" ").filter((token) => token.length >= 3);
  const normalizedTitle = normalizeToken(title);
  let hostname = "";
  try {
    hostname = normalizeToken(new URL(url).hostname.replace(/^www\./i, ""));
  } catch { return 0; }
  const titleTokens = normalizedTitle.split(" ");
  const hostTokens = hostname.split(" ");
  const titleMatches = tokens.filter((token) => titleTokens.some((part) => part.includes(token))).length;
  const hostMatches = tokens.filter((token) => hostTokens.some((part) => part.includes(token))).length;
  if (titleMatches === 0 || hostMatches === 0) return 0;
  return titleMatches * 3 + hostMatches * 2 +
    (["bank", "group", "foods", "food", "holdings", "plc", "limited", "ltd"].some((word) => titleTokens.includes(word)) ? 1 : 0);
}
function pageMentionsCompany(text: string, company: string) {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  const normalizedCompany = normalize(company);
  const normalizedText = normalize(text);
  if (normalizedCompany.length >= 5 && normalizedText.includes(normalizedCompany)) return true;
  const tokens = company.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 4);
  return tokens.length > 0 && tokens.every((token) => text.toLowerCase().includes(token));
}

export async function discoverCompanyDomain(company: string) {
  const seed = findCompany(company);
  if (seed) return { name: seed.name, domain: seed.domain, source: "catalogue" as const };

  const query = encodeURIComponent('"' + company + '" Nigeria official website');
  const searchUrl = "https://html.duckduckgo.com/html/?q=" + query;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);

  try {
    const response = await fetch(searchUrl, {
      signal: controller.signal,
      cache: "no-store",
      headers: { "user-agent": "Hunt-Opportunity-Intelligence/1.0 company discovery" },
    });
    if (!response.ok) return { name: company, domain: null, source: "search" as const };

    const html = (await response.text()).slice(0, 700000);
    const anchors = Array.from(html.matchAll(/<a\b[^>]*class=["'][^"']*\bresult__a\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi));
    const candidates: Array<{ url: string; title: string; score: number }> = [];
    for (const match of anchors) {
      const url = originalResultUrl(match[1]);
      const title = clean(match[2]).slice(0, 220);
      if (!url || !title) continue;
      const score = scoreCandidate(company, title, url);
      if (score < 4) continue;
      let host = "";
      try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { continue; }
      if (candidates.some((candidate) => new URL(candidate.url).hostname.toLowerCase().replace(/^www\./, "") === host)) continue;
      candidates.push({ url, title, score });
    }
    candidates.sort((a, b) => b.score - a.score);

    // A search-result title and matching-looking domain are only candidates.
    // Fetch the real site and require it to identify the company before storing
    // the domain. If identity cannot be established, keep the company domainless.
    for (const candidate of candidates.slice(0, 4)) {
      const pageController = new AbortController();
      const pageTimeout = setTimeout(() => pageController.abort(), 4000);
      try {
        const page = await fetch(candidate.url, {
          signal: pageController.signal,
          redirect: "follow",
          cache: "no-store",
          headers: { "user-agent": "Hunt-Opportunity-Intelligence/1.0 company discovery", accept: "text/html,application/xhtml+xml" },
        });
        if (!page.ok || (!page.headers.get("content-type") || !/text\/html|application\/xhtml\+xml/i.test(page.headers.get("content-type") || ""))) continue;
        const body = (await page.text()).slice(0, 350000);
        const title = clean(body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || candidate.title);
        const text = clean(body).slice(0, 100000);
        if (!pageMentionsCompany(title + " " + text, company)) continue;
        const finalUrl = new URL(page.url || candidate.url);
        if (!/^https?:$/.test(finalUrl.protocol)) continue;
        return { name: company, domain: finalUrl.hostname.toLowerCase().replace(/^www\./, ""), source: "verified_search" as const };
      } catch {
        // Try the next candidate; never promote a failed fetch to a verified domain.
      } finally {
        clearTimeout(pageTimeout);
      }
    }
    return { name: company, domain: null, source: "search_unverified" as const };
  } catch {
    return { name: company, domain: null, source: "search_unavailable" as const };
  } finally {
    clearTimeout(timeout);
  }
}

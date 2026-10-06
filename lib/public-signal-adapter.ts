import type { Observation, SignalAdapter, SignalAdapterResult } from "./signal-adapters";

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function clean(value: string) {
  return value.replace(/<script[\\s\\S]*?<\\/script>/gi, " ").replace(/<style[\\s\\S]*?<\\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\\s+/g, " ").trim();
}

function absolute(base: string, href: string) {
  try { return new URL(href, base).toString(); } catch { return null; }
}

const pagePaths = [
  "/news", "/press", "/press-releases", "/media", "/investors", "/investor-relations",
  "/about", "/about-us", "/leadership", "/team", "/locations", "/contact", "/careers",
  "/products", "/services", "/customers", "/partners", "/partnerships"
];

const rules: Array<{ type: Observation["type"]; category: string; pattern: RegExp; label: string }> = [
  { type: "funding", category: "Funding / investment", pattern: /raised|funding round|series [a-e]|investment|invested|financing|grant|capital raise|acquired|acquisition/i, label: "Funding or investment disclosure" },
  { type: "regulatory", category: "Regulatory / compliance", pattern: /licensed|licence|license|regulatory approval|approved by|certified|certification|compliance|regulator|regulatory requirement/i, label: "Regulatory or compliance disclosure" },
  { type: "partnership", category: "Partnership / relationship", pattern: /partnership|partnered with|strategic alliance|collaboration|supplier|customer|client|selected by|appointed as supplier/i, label: "Partnership or commercial relationship disclosure" },
  { type: "location", category: "Expansion / location", pattern: /new office|new branch|new facility|new plant|warehouse|expansion|expanded into|opened in|launch(?:ed)? in|enter(?:ed|ing) the .* market/i, label: "Expansion or location disclosure" },
];

export const publicSignalAdapter: SignalAdapter = {
  id: "public-company-signals",
  async collect(company, domain): Promise<SignalAdapterResult> {
    if (!domain) return { observations: [], errors: [] };
    const root = "https://" + domain;
    const urls = Array.from(new Set([root, ...pagePaths.map((p) => root + p)]));
    const observations: Observation[] = [];
    const errors: string[] = [];

    for (const url of urls) {
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
        const html = (await response.text()).slice(0, 500_000);
        const text = clean(html);
        if (!text) continue;
        const title = clean(html.match(/<title[^>]*>([\\s\\S]*?)<\\/title>/i)?.[1] || "");

        for (const rule of rules) {
          const match = text.match(rule.pattern);
          if (!match) continue;
          const contextStart = Math.max(0, (match.index || 0) - 180);
          const context = text.slice(contextStart, Math.min(text.length, contextStart + 420));
          observations.push({
            source: "Official website",
            type: rule.type,
            title: rule.label + ": " + (title || company),
            category: rule.category,
            url,
            observedAt: new Date().toISOString(),
            fingerprint: await sha256("public-signal|" + rule.type + "|" + url + "|" + match[0].toLowerCase()),
            metadata: { company, pageTitle: title, matchedTerm: match[0], context },
          });
        }

        const anchors = Array.from(html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\\s\\S]*?)<\\/a>/gi));
        for (const anchor of anchors) {
          const label = clean(anchor[2]);
          const href = absolute(url, anchor[1]);
          if (!href || !label) continue;
          if (/annual report|financial statement|financial results|investor report|accounts/i.test(label + " " + href)) continue;
          if (/supplier|customer|client|partner|partnership/i.test(label)) {
            observations.push({
              source: "Official website",
              type: "partnership",
              title: "Public relationship surface: " + label.slice(0, 180),
              category: "Supplier / customer / partnership",
              url: href,
              observedAt: new Date().toISOString(),
              fingerprint: await sha256("relationship-surface|" + href + "|" + label.toLowerCase()),
              metadata: { company, label },
            });
          }
        }
      } catch {
        // Optional public evidence pages are best-effort.
      } finally {
        clearTimeout(timeout);
      }
    }

    return {
      observations: Array.from(new Map(observations.map((o) => [o.fingerprint, o])).values()),
      errors: Array.from(new Set(errors)),
    };
  },
};

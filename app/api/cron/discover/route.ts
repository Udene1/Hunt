import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma, databaseConfigured } from "../../../../lib/db";
import { COMPANY_CATALOG, normalizeCompany } from "../../../../lib/companies";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type DiscoveryFamily = {
  id: string;
  category: string;
  type: string;
  query: string;
};

const FAMILIES: DiscoveryFamily[] = [
  { id: "expansion", category: "Expansion / location", type: "location", query: 'Nigeria company "new plant" OR "new factory" OR "expansion" OR "new facility"' },
  { id: "procurement", category: "Procurement / contracts", type: "procurement", query: 'Nigeria company tender procurement contract award supplier 2026' },
  { id: "funding", category: "Funding / investment", type: "funding", query: 'Nigeria company investment financing funding acquisition 2026' },
  { id: "relationships", category: "Supplier / customer / partnership", type: "partnership", query: 'Nigeria company selected supplier customer partnership contract 2026' },
  { id: "regulatory", category: "Regulatory / compliance", type: "regulatory", query: 'site:cbn.gov.ng OR site:sec.gov.ng OR site:cac.gov.ng Nigeria company licence approval filing' },
  { id: "financial", category: "Financial reporting", type: "financial", query: 'Nigeria company annual report financial results revenue assets 2025 OR 2026' },
  { id: "operations", category: "Business / operations", type: "business", query: 'Nigeria company production capacity distribution logistics manufacturing operations 2026' },
];

const blockedHosts = new Set([
  "facebook.com", "instagram.com", "linkedin.com", "x.com", "twitter.com",
  "youtube.com", "tiktok.com", "duckduckgo.com",
]);

function clean(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'").replace(/&#x27;/gi, "'")
    .replace(/\s+/g, " ").trim();
}

function unwrapUrl(raw: string) {
  try {
    const parsed = new URL(raw, "https://html.duckduckgo.com");
    const target = parsed.searchParams.get("uddg");
    const url = new URL(target || parsed.toString());
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (blockedHosts.has(host) || Array.from(blockedHosts).some((blocked) => host.endsWith("." + blocked))) return null;
    url.hash = "";
    return url.toString();
  } catch { return null; }
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function matchKnownCompany(text: string, companies: Array<{ id?: string; name: string; domain: string | null }>) {
  const normalizedText = text.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const matches = companies
    .filter((company) => company.name.trim().length >= 4)
    .filter((company) => normalizedText.includes(company.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()))
    .sort((a, b) => b.name.length - a.name.length);
  return matches[0] || null;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!databaseConfigured()) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  const runAt = new Date();
  const companiesInDb = await prisma.company.findMany({
    select: { id: true, name: true, domain: true },
    take: 2000,
  });
  const companies = [
    ...COMPANY_CATALOG.map((company) => ({ name: company.name, domain: company.domain, id: companiesInDb.find((row) => normalizeCompany(row.name) === normalizeCompany(company.name))?.id })),
    ...companiesInDb,
  ].filter((company, index, all) => all.findIndex((other) => normalizeCompany(other.name) === normalizeCompany(company.name)) === index);

  const requestedFamily = new URL(request.url).searchParams.get("family");
  const familiesToRun = requestedFamily ? FAMILIES.filter((family) => family.id === requestedFamily) : FAMILIES;
  if (requestedFamily && familiesToRun.length === 0) {
    return NextResponse.json({ ok: false, error: "Unknown discovery family", allowed: FAMILIES.map((family) => family.id) }, { status: 400 });
  }
  const results: Array<{ family: string; fetched: number; attached: number; queued: number; errors: string[] }> = [];
  let attached = 0;
  let queued = 0;

  for (const family of familiesToRun) {
    const errors: string[] = [];
    let familyFetched = 0;
    let familyAttached = 0;
    let familyQueued = 0;
    const searchUrl = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(family.query);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);

    try {
      const response = await fetch(searchUrl, {
        signal: controller.signal,
        cache: "no-store",
        headers: { "user-agent": "Opportunity-Intelligence/0.6 public-discovery" },
      });
      if (!response.ok) throw new Error("Search provider returned HTTP " + response.status);
      const html = (await response.text()).slice(0, 900000);
      const anchors = Array.from(html.matchAll(/<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi));

      for (const anchor of anchors.slice(0, 5)) {
        const url = unwrapUrl(anchor[1]);
        const title = clean(anchor[2]).slice(0, 220);
        if (!url || title.length < 12) continue;
        familyFetched++;

        const fingerprint = await sha256("hunt-public-discovery|" + family.id + "|" + url);
        const known = matchKnownCompany(title, companies);
        const taskTitle = "Public discovery candidate: " + title.slice(0, 170);
        const detail = "Discovered by Hunt's scheduled public search. Topic: " + family.category + ". This is a search-result candidate, not a verified claim. Confirm the source page, entity identity, event date and whether it belongs to an existing company before treating it as a signal.";
        let knownCompanyId = known?.id || null;

        // Curated catalogue identity is sufficient to create its missing durable
        // company row; arbitrary names extracted from web results are not.
        if (known && !knownCompanyId) {
          const seed = COMPANY_CATALOG.find((company) => normalizeCompany(company.name) === normalizeCompany(known.name));
          if (seed) {
            const dbCompany = await prisma.company.upsert({
              where: { normalized: normalizeCompany(seed.name) },
              update: { domain: seed.domain },
              create: { name: seed.name, normalized: normalizeCompany(seed.name), domain: seed.domain, country: "NG" },
              select: { id: true },
            });
            knownCompanyId = dbCompany.id;
          }
        }

        if (known && knownCompanyId) {
          // Only attach a search result to a known company when the company name
          // appears in the result title. Reachability is checked before persistence.
          try {
            const evidenceController = new AbortController();
            const evidenceTimeout = setTimeout(() => evidenceController.abort(), 4000);
            let finalUrl = url;
            let reachable = false;
            try {
              const evidenceResponse = await fetch(url, {
                method: "GET",
                signal: evidenceController.signal,
                redirect: "follow",
                cache: "no-store",
                headers: { "user-agent": "Opportunity-Intelligence/0.6 evidence-check", accept: "text/html,application/pdf,text/plain,*/*" },
              });
              reachable = evidenceResponse.ok;
              finalUrl = evidenceResponse.url || url;
              if (evidenceResponse.body) await evidenceResponse.body.cancel().catch(() => {});
            } finally { clearTimeout(evidenceTimeout); }

            if (reachable) {
              await prisma.observation.upsert({
                where: { companyId_fingerprint: { companyId: knownCompanyId, fingerprint } },
                update: { lastSeenAt: runAt, url: finalUrl, metadata: { discoveryFamily: family.id, candidateOnly: true, sourceUrl: finalUrl, searchQuery: family.query } },
                create: {
                  companyId: knownCompanyId,
                  source: "Scheduled public discovery",
                  type: family.type,
                  category: family.category,
                  title,
                  url: finalUrl,
                  fingerprint,
                  observedAt: runAt,
                  metadata: { discoveryFamily: family.id, candidateOnly: true, sourceUrl: finalUrl, searchQuery: family.query, identityMatch: "company name appears in result title; claim not independently verified" },
                  sourceTier: "secondary",
                  verificationStatus: "reachable_unverified",
                  entityConfidence: 55,
                  evidenceConfidence: 45,
                },
              });
              familyAttached++;
              attached++;
              continue;
            }
          } catch (error) {
            errors.push("Evidence persistence/check failed: " + (error instanceof Error ? error.message : String(error)));
          }
        }

        // Unknown or ambiguous entities are kept durably for review instead of
        // being guessed into the company catalogue or silently discarded.
        await prisma.adminReviewTask.upsert({
          where: { fingerprint },
          update: {
            title: taskTitle,
            detail,
            sourceUrl: url,
            metadata: {
              kind: "public_discovery_candidate",
              family: family.id,
              category: family.category,
              candidateTitle: title,
              searchQuery: family.query,
              lastSeenAt: runAt.toISOString(),
              matchedCompany: known?.name || null,
              identityStatus: known ? "known_name_but_source_unreachable" : "unresolved",
              claimVerificationStatus: "not_independently_verified",
            } as Prisma.InputJsonValue,
          },
          create: {
            type: "public_discovery_candidate",
            severity: "medium",
            title: taskTitle,
            detail,
            sourceUrl: url,
            fingerprint,
            metadata: {
              kind: "public_discovery_candidate",
              family: family.id,
              category: family.category,
              candidateTitle: title,
              searchQuery: family.query,
              firstSeenAt: runAt.toISOString(),
              matchedCompany: known?.name || null,
              identityStatus: known ? "known_name_but_no_persisted_match_or_unreachable" : "unresolved",
              claimVerificationStatus: "not_independently_verified",
            } as Prisma.InputJsonValue,
          },
        });
        familyQueued++;
        queued++;
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timeout);
    }

    results.push({ family: family.id, fetched: familyFetched, attached: familyAttached, queued: familyQueued, errors });
  }

  return NextResponse.json({
    ok: true,
    runAt: runAt.toISOString(),
    source: "DuckDuckGo HTML public search",
    families: FAMILIES.length,
    fetched: results.reduce((sum, item) => sum + item.fetched, 0),
    attached,
    queued,
    results,
    note: "Candidates are discovery leads, not verified facts. Ambiguous/new-company identities remain in the admin review queue; this route does not auto-create companies from search-result titles.",
  });
}

import { NextResponse } from "next/server";
import { databaseConfigured, prisma } from "../../../lib/db";
import { COMPANY_CATALOG, type CompanySeed } from "../../../lib/companies";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim().toLowerCase() || "";
  const companies = COMPANY_CATALOG.filter((c) => !q || [c.name, c.domain, c.description, ...c.sectors].join(" ").toLowerCase().includes(q));

  let persisted: Array<{ name: string; domain: string | null; country: string; updatedAt: Date; generalSummary: string | null }> = [];
  if (databaseConfigured()) {
    try {
      persisted = await prisma.company.findMany({
        where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { domain: { contains: q, mode: "insensitive" } }] } : undefined,
        orderBy: { updatedAt: "desc" },
        take: 100,
        select: { name: true, domain: true, country: true, updatedAt: true, generalSummary: true },
      });
    } catch {}
  }

  type DirectoryCompany = CompanySeed & { persisted: boolean; summary?: string | null };
  const merged = new Map<string, DirectoryCompany>(companies.map((c) => [c.name.toLowerCase(), { ...c, persisted: false }]));
  for (const c of persisted) {
    const key = c.name.toLowerCase();
    const existing = merged.get(key);
    if (existing) {
      merged.set(key, { ...existing, domain: existing.domain, persisted: true, summary: c.generalSummary });
    } else {
      merged.set(key, {
        name: c.name,
        domain: c.domain || "",
        description: "Company with durable public evidence collected by Hunt.",
        sectors: [c.country === "NG" ? "Nigeria" : c.country],
        persisted: true,
      });
    }
  }

  const allCompanies = Array.from(merged.values());
  const canonicalDomains = new Set(COMPANY_CATALOG.map((company) => company.domain.toLowerCase().replace(/^www\\./, "")));
  const normalizedName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  // Older automatic search scans created truncated company names while users typed.
  // Hide only unsubstantiated prefix records when a longer company record exists;
  // preserve rows with a summary or a known canonical domain. Do not delete history.
  const visibleCompanies = allCompanies.filter((company) => {
    if (!company.persisted || company.summary) return true;
    const normalized = normalizedName(company.name);
    const domain = company.domain.toLowerCase().replace(/^www\\./, "");
    const hasKnownDomain = canonicalDomains.has(domain);
    if (hasKnownDomain) return true;
    return !allCompanies.some((other) => {
      if (other.name.toLowerCase() === company.name.toLowerCase()) return false;
      const otherName = normalizedName(other.name);
      return otherName.length > normalized.length && otherName.startsWith(normalized);
    });
  });

  return NextResponse.json({
    companies: visibleCompanies.filter((company) => !q || [company.name, company.domain, company.description, ...company.sectors].join(" ").toLowerCase().includes(q)).slice(0, 100),
    count: visibleCompanies.length,
    persistentDirectory: databaseConfigured(),
  });
}

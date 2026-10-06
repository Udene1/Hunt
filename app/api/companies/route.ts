import { NextResponse } from "next/server";
import { databaseConfigured, prisma } from "../../../lib/db";
import { COMPANY_CATALOG, type CompanySeed } from "../../../lib/companies";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim().toLowerCase() || "";
  const companies = COMPANY_CATALOG.filter((c) => !q || [c.name, c.domain, c.description, ...c.sectors].join(" ").toLowerCase().includes(q));

  let persisted: Array<{ name: string; domain: string | null; country: string; updatedAt: Date }> = [];
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
      merged.set(key, { ...existing, domain: c.domain || existing.domain, persisted: true, summary: c.generalSummary });
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

  return NextResponse.json({
    companies: Array.from(merged.values()).slice(0, 100),
    count: merged.size,
    persistentDirectory: databaseConfigured(),
  });
}

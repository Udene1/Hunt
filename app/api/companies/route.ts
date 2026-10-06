import { NextResponse } from "next/server";
import { databaseConfigured, prisma } from "../../../lib/db";
import { COMPANY_CATALOG } from "../../../lib/companies";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim().toLowerCase() || "";
  const companies = COMPANY_CATALOG.filter((c) => {
    if (!q) return true;
    return [c.name, c.domain, c.description, ...c.sectors].join(" ").toLowerCase().includes(q);
  });
  let persisted: Array<{ name: string; domain: string | null; country: string; updatedAt: Date }> = [];
  if (databaseConfigured()) {\n    try { persisted = await prisma.company.findMany({ where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { domain: { contains: q, mode: "insensitive" } }] } : undefined, orderBy: { updatedAt: "desc" }, take: 100, select: { name: true, domain: true, country: true, updatedAt: true } }); } catch {}\n  }\n  const merged = new Map(companies.map((c) => [c.name.toLowerCase(), { ...c, persisted: false }]));\n  for (const c of persisted) { const key = c.name.toLowerCase(); const existing = merged.get(key); merged.set(key, existing ? { ...existing, domain: c.domain || existing.domain, persisted: true } : { name: c.name, domain: c.domain || "", description: "Company with durable public evidence collected by Hunt.", sectors: [c.country === "NG" ? "Nigeria" : c.country], persisted: true }); }\n  return NextResponse.json({ companies: Array.from(merged.values()).slice(0, 100), count: merged.size, persistentDirectory: databaseConfigured() });
}

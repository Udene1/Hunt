import { NextResponse } from "next/server";
import { getAdminBearer } from "../../../../lib/auth";
import { databaseConfigured, prisma } from "../../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!databaseConfigured()) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  if (!await getAdminBearer(request)) return NextResponse.json({ error: "Admin authentication required." }, { status: 401 });
  const companies = await prisma.company.findMany({
    where: { OR: [{ generalSummary: null }, { summaryEvidenceAt: { not: null } }] },
    orderBy: { updatedAt: "desc" },
    take: 5000,
    select: { id: true, name: true, domain: true, generalSummary: true, summaryUpdatedAt: true, summaryEvidenceAt: true, summaryVersion: true },
  });
  const missing = companies.filter((c) => !c.generalSummary);
  const stale = companies.filter((c) => !!c.generalSummary && !!c.summaryEvidenceAt && (!c.summaryUpdatedAt || c.summaryEvidenceAt > c.summaryUpdatedAt));
  return NextResponse.json({ missing, stale, counts: { missing: missing.length, stale: stale.length } });
}

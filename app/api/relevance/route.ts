import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../lib/auth";
import { requireMonitoringAccess } from "../../../lib/entitlements";
import { databaseConfigured, prisma } from "../../../lib/db";
import { scoreCompanyRelevance } from "../../../lib/relevance";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!databaseConfigured()) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const access = await requireMonitoringAccess();
  if (!access.allowed) return NextResponse.json({ error: access.reason === "authentication_required" ? "Authentication required." : "Pilot or paid access required.", code: access.reason }, { status: access.reason === "authentication_required" ? 401 : 402 });

  const companyName = new URL(request.url).searchParams.get("company")?.trim();
  if (!companyName) return NextResponse.json({ error: "company is required" }, { status: 400 });

  const company = await prisma.company.findFirst({
    where: { name: { equals: companyName, mode: "insensitive" } },
    include: { observations: { orderBy: { observedAt: "desc" }, take: 100 } },
  });
  if (!company) return NextResponse.json({ error: "Company not found in Hunt history." }, { status: 404 });

  const result = scoreCompanyRelevance(access.user.profile || {}, company, company.observations);
  return NextResponse.json({
    company: { name: company.name, domain: company.domain, country: company.country },
    relevance: result,
    generatedAt: new Date().toISOString(),
    basis: "deterministic evidence-to-objective matching; no model inference",
  });
}

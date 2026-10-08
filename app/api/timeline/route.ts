import { NextResponse } from "next/server";
import { prisma, databaseConfigured } from "../../../lib/db";
import { findCompany, normalizeCompany } from "../../../lib/companies";
import { requireMonitoringAccess } from "../../../lib/entitlements";

export async function GET(request: Request) {
  const access = await requireMonitoringAccess();
  if (!access.allowed) return NextResponse.json({ error: "Monitoring access required.", code: access.reason }, { status: access.reason === "authentication_required" ? 401 : 402 });
  if (!databaseConfigured()) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const raw = new URL(request.url).searchParams.get("company")?.trim();
  if (!raw) return NextResponse.json({ error: "company is required" }, { status: 400 });
  const seed = findCompany(raw);
  const company = await prisma.company.findUnique({ where: { normalized: normalizeCompany(seed?.name || raw) } });
  if (!company) return NextResponse.json({ error: "Company not found in Hunt history." }, { status: 404 });

  const [observations, clusters, signals] = await Promise.all([
    prisma.observation.findMany({ where: { companyId: company.id }, orderBy: { observedAt: "desc" }, take: 200 }),
    prisma.signalCluster.findMany({ where: { companyId: company.id }, orderBy: { lastSeenAt: "desc" }, take: 50 }),
    prisma.signal.findMany({ where: { companyId: company.id }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  const events = [
    ...observations.map(o => ({ at:o.observedAt, kind:"evidence", category:o.category, title:o.title, source:o.source, url:o.url, status:o.status, confidence:o.evidenceConfidence, entityConfidence:o.entityConfidence })),
    ...clusters.map(c => ({ at:c.lastSeenAt, kind:"cluster", category:(c.categories as string[]).join(" + "), title:c.headline, source:"Hunt signal cluster", url:null, status:"active", confidence:80, entityConfidence:90, score:c.score, windowStart:c.windowStart, windowEnd:c.windowEnd })),
    ...signals.map(s => ({ at:s.createdAt, kind:"signal", category:"Commercial signal", title:s.headline, source:"Hunt", url:null, status:"active", confidence:70, entityConfidence:100, score:s.score, detail:s.commercialInterpretation })),
  ].sort((a,b)=>new Date(b.at).getTime()-new Date(a.at).getTime());
  return NextResponse.json({
    company:{name:company.name,domain:company.domain,summary:company.generalSummary},
    timeline:events.slice(0,150),
    interpretationRule:"Timeline records what changed and what evidence supports it. It does not assert a commercial conclusion.",
    generatedAt:new Date().toISOString()
  });
}
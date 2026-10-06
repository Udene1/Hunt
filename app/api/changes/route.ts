import { NextResponse } from "next/server";
import { prisma, databaseConfigured } from "../../../lib/db";
import { findCompany, normalizeCompany } from "../../../lib/companies";
import { requireMonitoringAccess } from "../../../lib/entitlements";

export async function GET(request: Request) {
  const access = await requireMonitoringAccess();
  if (!access.allowed) return NextResponse.json({ error: access.reason === "authentication_required" ? "Authentication required." : "Pilot or paid access required.", code: access.reason }, { status: access.reason === "authentication_required" ? 401 : 402 });
  if (!databaseConfigured()) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const raw = new URL(request.url).searchParams.get("company")?.trim();
  if (!raw) return NextResponse.json({ error: "company is required" }, { status: 400 });
  const seed = findCompany(raw);
  const normalized = normalizeCompany(seed?.name || raw);
  const company = await prisma.company.findUnique({ where: { normalized } });
  if (!company) return NextResponse.json({ error: "Company not found in Hunt history." }, { status: 404 });

  const [observations, clusters, signals] = await Promise.all([
    prisma.observation.findMany({ where: { companyId: company.id }, orderBy: { observedAt: "desc" }, take: 100 }),
    prisma.signalCluster.findMany({ where: { companyId: company.id }, orderBy: { lastSeenAt: "desc" }, take: 20 }),
    prisma.signal.findMany({ where: { companyId: company.id }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  const active = observations.filter((o) => o.status === "active");
  const removed = observations.filter((o) => o.status === "confirmed_removed");
  const recent = observations.slice(0, 25);
  const categories = Array.from(new Set(recent.map((o) => o.category)));
  const payload = {
    company: { name: company.name, domain: company.domain, summary: company.generalSummary },
    changes: {
      recentEvidence: recent,
      removedEvidence: removed.slice(0, 20),
      activeCategories: categories,
      latestSignals: signals,
      clusters,
      interpretationRule: "Hunt reports durable changes and intersections; the connected AI decides what they mean commercially.",
    },
    generatedAt: new Date().toISOString(),
    counts: { active: active.length, removed: removed.length, clusters: clusters.length, signals: signals.length },
  };
  return NextResponse.json(payload);
}

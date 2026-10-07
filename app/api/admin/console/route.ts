import { NextResponse } from "next/server";
import { getAdminBearer } from "../../../../lib/auth";
import { databaseConfigured, prisma } from "../../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!databaseConfigured()) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  if (!await getAdminBearer(request)) return NextResponse.json({ error: "Admin authentication required." }, { status: 401 });

  const now = new Date();
  const [users, activeSessions, pilotAvailable, pilotRedeemed, openReviews, companies, missingSummary, staleSummary, recentUsers, locations, recentRuns] = await Promise.all([
    prisma.user.count(),
    prisma.session.count({ where: { expiresAt: { gt: now } } }),
    prisma.pilotCode.count({ where: { redeemedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }),
    prisma.pilotCode.count({ where: { redeemedAt: { not: null } } }),
    prisma.adminReviewTask.count({ where: { status: "open" } }),
    prisma.company.count(),
    prisma.company.count({ where: { generalSummary: null } }),
    prisma.company.findMany({ where: { generalSummary: { not: null }, summaryEvidenceAt: { not: null } }, select: { summaryUpdatedAt: true, summaryEvidenceAt: true } }).then((rows) => rows.filter((row) => row.summaryEvidenceAt && (!row.summaryUpdatedAt || row.summaryEvidenceAt > row.summaryUpdatedAt)).length),
    prisma.user.findMany({ orderBy: { createdAt: "desc" }, take: 10, select: { email: true, plan: true, createdAt: true, updatedAt: true } }),
    prisma.auditEvent.findMany({ where: { action: { in: ["login", "register"] } }, orderBy: { createdAt: "desc" }, take: 500, select: { action: true, metadata: true, createdAt: true } }),
    prisma.monitoringRun.findMany({ orderBy: { startedAt: "desc" }, take: 10, include: { company: { select: { name: true } } } }),
  ]);

  const locationCounts: Record<string, number> = {};
  for (const event of locations) {
    const m = event.metadata && typeof event.metadata === "object" ? event.metadata as Record<string, unknown> : {};
    const country = typeof m.country === "string" ? m.country : "Unknown";
    const city = typeof m.city === "string" ? m.city : "";
    const key = city ? city + ", " + country : country;
    locationCounts[key] = (locationCounts[key] || 0) + 1;
  }

  return NextResponse.json({
    metrics: { users, activeSessions, pilotAvailable, pilotRedeemed, openReviews, companies, missingSummary, staleSummary },
    recentUsers,
    locations: Object.entries(locationCounts).sort((a,b) => b[1]-a[1]).slice(0, 20).map(([location,count]) => ({ location, count })),
    recentRuns,
  });
}

import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../lib/auth";
import { monitoringEntitled } from "../../../lib/entitlements";
import { databaseConfigured, prisma } from "../../../lib/db";

export async function GET(request: Request) {
  if (!databaseConfigured()) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required.", code: "authentication_required" }, { status: 401 });
  if (!monitoringEntitled(user)) return NextResponse.json({ error: "Pilot or paid access required.", code: "plan_required" }, { status: 402 });
  const limit = Math.min(50, Math.max(1, Number(new URL(request.url).searchParams.get("limit") || 20)));
  const candidates = await prisma.opportunityCandidate.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    take: limit,
    include: { company: true, cluster: true },
  });
  return NextResponse.json({ opportunities: candidates, generatedAt: new Date().toISOString() });
}

import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../lib/auth";
import { monitoringEntitled } from "../../../lib/entitlements";
import { databaseConfigured, prisma } from "../../../lib/db";

export async function GET() {
  if (!databaseConfigured()) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required.", code: "authentication_required" }, { status: 401 });
  if (!monitoringEntitled(user)) return NextResponse.json({ error: "Pilot or paid access required.", code: "plan_required" }, { status: 402 });
  const notifications = await prisma.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { company: true, opportunity: true },
  });
  return NextResponse.json({ unread: notifications.filter((n) => !n.readAt).length, notifications });
}

export async function POST(request: Request) {
  if (!databaseConfigured()) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!monitoringEntitled(user)) return NextResponse.json({ error: "Pilot or paid access required." }, { status: 402 });
  const body = await request.json().catch(() => ({}));
  const ids = Array.isArray(body.ids) ? body.ids.filter((x: unknown): x is string => typeof x === "string").slice(0, 50) : [];
  await prisma.notification.updateMany({ where: { id: { in: ids }, userId: user.id }, data: { readAt: new Date() } });
  return NextResponse.json({ ok: true });
}

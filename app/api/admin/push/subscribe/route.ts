import { NextResponse } from "next/server";
import { getAdminBearer } from "../../../../../lib/auth";
import { databaseConfigured, prisma } from "../../../../../lib/db";

export async function POST(request: Request) {
  if (!databaseConfigured()) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  if (!await getAdminBearer(request)) return NextResponse.json({ error: "Admin bearer authentication required." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const endpoint = body?.endpoint;
  const keys = body?.keys;
  if (typeof endpoint !== "string" || typeof keys?.p256dh !== "string" || typeof keys?.auth !== "string") {
    return NextResponse.json({ error: "A valid PushSubscription is required." }, { status: 400 });
  }
  const subscription = await prisma.adminPushSubscription.upsert({
    where: { endpoint },
    update: { p256dh: keys.p256dh, auth: keys.auth, lastUsedAt: new Date() },
    create: { endpoint, p256dh: keys.p256dh, auth: keys.auth },
  });
  return NextResponse.json({ ok: true, id: subscription.id });
}

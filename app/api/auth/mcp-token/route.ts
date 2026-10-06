import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser, hashToken } from "../../../../lib/auth";
import { monitoringEntitled } from "../../../../lib/entitlements";
import { databaseConfigured, prisma } from "../../../../lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!databaseConfigured()) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!monitoringEntitled(user)) return NextResponse.json({ error: "Pilot or paid access required." }, { status: 402 });

  const body = await request.json().catch(() => ({}));
  const label = typeof body?.label === "string" && body.label.trim() ? body.label.trim().slice(0, 80) : "MCP";
  const token = "hunt_" + randomBytes(32).toString("base64url");
  const record = await prisma.accessToken.create({
    data: { userId: user.id, tokenHash: hashToken(token), label },
    select: { id: true, label: true, createdAt: true },
  });
  return NextResponse.json({ token, accessToken: record, warning: "Copy this token now. Hunt will not show the secret again." }, { status: 201 });
}

export async function DELETE(request: Request) {
  if (!databaseConfigured()) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  await prisma.accessToken.updateMany({ where: { id, userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  return NextResponse.json({ ok: true });
}

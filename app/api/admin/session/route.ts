import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { databaseConfigured, hashToken } from "../../../../lib/auth";
import { prisma } from "../../../../lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!databaseConfigured()) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const body = await request.json().catch(() => ({}));
  if (!process.env.HUNT_ADMIN_SECRET || body.secret !== process.env.HUNT_ADMIN_SECRET) {
    return NextResponse.json({ error: "Invalid admin credential." }, { status: 401 });
  }
  const token = randomBytes(32).toString("base64url");
  await prisma.adminAccessToken.create({ data: { tokenHash: hashToken(token), label: "Admin console" } });
  const response = NextResponse.json({ ok: true });
  response.cookies.set("hunt_admin_session", token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 12,
  });
  return response;
}

export async function DELETE(request: Request) {
  const token = (request.headers.get("cookie") || "").match(/(?:^|;\s*)hunt_admin_session=([^;]+)/)?.[1];
  if (token) await prisma.adminAccessToken.updateMany({ where: { tokenHash: hashToken(token) }, data: { revokedAt: new Date() } });
  const response = NextResponse.json({ ok: true });
  response.cookies.set("hunt_admin_session", "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}

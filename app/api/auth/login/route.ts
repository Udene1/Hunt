import { NextResponse } from "next/server";
import { databaseConfigured, prisma } from "../../../../lib/db";
import { createUserSession, verifyPassword } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!databaseConfigured()) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const user = await prisma.user.findUnique({ where: { email }, include: { profile: true } });
  if (!user || !verifyPassword(password, user.passwordHash)) return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  await createUserSession(user.id);
  await prisma.auditEvent.create({ data: { userId: user.id, action: "login", resource: "auth", metadata: { country: request.headers.get("x-vercel-ip-country"), region: request.headers.get("x-vercel-ip-country-region"), city: request.headers.get("x-vercel-ip-city") } } }).catch(() => {});

  return NextResponse.json({ user: { id: user.id, email: user.email, plan: user.plan, pilotExpiresAt: user.pilotExpiresAt }, profile: user.profile });
}

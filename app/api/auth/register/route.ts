import { NextResponse } from "next/server";
import { databaseConfigured, prisma } from "../../../../lib/db";
import { createUserSession, hashPassword } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!databaseConfigured()) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  if (password.length < 10) return NextResponse.json({ error: "Password must be at least 10 characters." }, { status: 400 });

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return NextResponse.json({ error: "An account with that email already exists." }, { status: 409 });

  const user = await prisma.user.create({
    data: { email, passwordHash: hashPassword(password), profile: { create: {} } },
    include: { profile: true },
  });
  await createUserSession(user.id);
  return NextResponse.json({ user: { id: user.id, email: user.email, plan: user.plan }, profile: user.profile }, { status: 201 });
}

import { NextResponse } from "next/server";
import { randomInt } from "node:crypto";
import { getAdminBearer, hashToken } from "../../../../lib/auth";
import { databaseConfigured, prisma } from "../../../../lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!await getAdminBearer(request)) return new Response("Unauthorized", { status: 401 });
  const codes = await prisma.pilotCode.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { redeemedBy: { select: { email: true } } } });
  return NextResponse.json({ codes: codes.map((code) => ({ id: code.id, status: code.redeemedAt ? "redeemed" : code.expiresAt && code.expiresAt <= new Date() ? "expired" : "available", createdAt: code.createdAt, expiresAt: code.expiresAt, redeemedAt: code.redeemedAt, redeemedBy: code.redeemedBy, durationDays: code.durationDays })) });
}

export async function POST(request: Request) {
  if (!await getAdminBearer(request)) return new Response("Unauthorized", { status: 401 });
  if (!databaseConfigured()) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });

  const body = await request.json().catch(() => ({}));
  const durationDays = Math.min(90, Math.max(1, Number(body.durationDays) || 14));
  const validityDays = Math.min(30, Math.max(1, Number(body.validityDays) || 7));

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = String(randomInt(10000000, 100000000));
    try {
      await prisma.pilotCode.create({
        data: {
          codeHash: hashToken(code),
          durationDays,
          expiresAt: new Date(Date.now() + validityDays * 86400000),
        },
      });
      return NextResponse.json({ code, durationDays, expiresAt: new Date(Date.now() + validityDays * 86400000) }, { status: 201 });
    } catch {
      if (attempt === 4) return NextResponse.json({ error: "Could not generate a unique pilot code." }, { status: 500 });
    }
  }
  return NextResponse.json({ error: "Could not generate pilot code." }, { status: 500 });
}

import { NextResponse } from "next/server";
import { hashToken, getCurrentUser } from "../../../../lib/auth";
import { databaseConfigured, prisma } from "../../../../lib/db";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!databaseConfigured()) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const code = typeof body?.code === "string" ? body.code.replace(/\D/g, "") : "";
  if (!/^\d{8}$/.test(code)) return NextResponse.json({ error: "Enter the 8-digit pilot PIN." }, { status: 400 });

  const now = new Date();
  try {
    const result = await prisma.$transaction(async (tx) => {
      const invite = await tx.pilotCode.findUnique({ where: { codeHash: hashToken(code) } });
      if (!invite) throw new Error("INVALID_CODE");
      if (invite.redeemedAt || invite.redeemedByUserId) throw new Error("USED_CODE");
      if (invite.expiresAt && invite.expiresAt <= now) throw new Error("EXPIRED_CODE");

      const pilotExpiresAt = new Date(now.getTime() + invite.durationDays * 86400000);
      await tx.pilotCode.update({
        where: { id: invite.id },
        data: { redeemedAt: now, redeemedByUserId: user.id },
      });
      return tx.user.update({
        where: { id: user.id },
        data: { plan: "pilot", pilotExpiresAt },
        select: { id: true, email: true, plan: true, pilotExpiresAt: true },
      });
    });
    return NextResponse.json({ user: result, message: "Pilot activated." });
  } catch (error) {
    const codeError = error instanceof Error ? error.message : "";
    const status = codeError === "USED_CODE" || codeError === "EXPIRED_CODE" ? 409 : codeError === "INVALID_CODE" ? 404 : 500;
    return NextResponse.json({ error: status === 404 ? "Invalid pilot PIN." : status === 409 ? "That pilot PIN is no longer available." : "Could not activate the pilot." }, { status });
  }
}

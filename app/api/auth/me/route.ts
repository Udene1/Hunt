import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ user: null }, { status: 401 });
  return NextResponse.json({
    user: { id: user.id, email: user.email, plan: user.plan, pilotExpiresAt: user.pilotExpiresAt, createdAt: user.createdAt },
    profile: user.profile,
  });
}

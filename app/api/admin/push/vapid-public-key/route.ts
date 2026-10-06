import { NextResponse } from "next/server";
import { getAdminBearer } from "../../../../../lib/auth";

export async function GET(request: Request) {
  if (!await getAdminBearer(request)) return NextResponse.json({ error: "Admin bearer authentication required." }, { status: 401 });
  const key = process.env.HUNT_ADMIN_VAPID_PUBLIC_KEY;
  if (!key) return NextResponse.json({ error: "Admin push is not configured." }, { status: 503 });
  return NextResponse.json({ publicKey: key });
}

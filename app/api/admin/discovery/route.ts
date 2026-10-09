import { NextResponse } from "next/server";
import { getAdminBearer } from "../../../../lib/auth";
import { databaseConfigured } from "../../../../lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!databaseConfigured()) {
    return NextResponse.json({ ok: false, error: "Database unavailable" }, { status: 503 });
  }
  if (!await getAdminBearer(request)) {
    return NextResponse.json({ ok: false, error: "Admin authentication required." }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const kind = body?.kind;
  if (kind !== "discovery" && kind !== "monitor") {
    return NextResponse.json({ ok: false, error: "kind must be discovery or monitor" }, { status: 400 });
  }

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  }

  const path = kind === "discovery" ? "/api/cron/discover" : "/api/cron/monitor";
  const target = new URL(path, request.url);
  try {
    const response = await fetch(target, {
      method: "GET",
      cache: "no-store",
      headers: { authorization: `Bearer ${secret}`, accept: "application/json" },
      signal: AbortSignal.timeout(58_000),
    });
    const result = await response.json().catch(async () => ({ error: (await response.text().catch(() => "")).slice(0, 1000) }));
    return NextResponse.json({ ok: response.ok, kind, status: response.status, result }, { status: response.ok ? 200 : response.status });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      kind,
      error: error instanceof Error ? error.message : "Scan request failed",
      note: "The request may have timed out; check the review queue and monitoring history before retrying.",
    }, { status: 504 });
  }
}

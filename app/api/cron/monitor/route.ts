import { NextResponse } from "next/server";
import { prisma, databaseConfigured } from "../../../../lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!databaseConfigured()) {
    return NextResponse.json({ ok: false, error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  const [legacyWatches, userWatches] = await Promise.all([
    prisma.watch.findMany({ include: { company: true }, orderBy: { createdAt: "asc" } }),
    prisma.userWatch.findMany({ include: { company: true }, orderBy: { createdAt: "asc" } }),
  ]);

  const companyMap = new Map<string, typeof legacyWatches[number]["company"]>();
  for (const watch of legacyWatches) companyMap.set(watch.company.id, watch.company);
  for (const watch of userWatches) companyMap.set(watch.company.id, watch.company);
  const watches = Array.from(companyMap.values());

  if (!watches.length) {
    return NextResponse.json({ ok: true, selected: 0, processed: 0, results: [] });
  }

  const batchSize = 5;
  const batchCount = Math.max(1, Math.ceil(watches.length / batchSize));
  const dayIndex = Math.floor(Date.now() / 86_400_000);
  const batchIndex = dayIndex % batchCount;
  const selected = watches.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize);
  const origin = new URL(request.url).origin;

  const results = [];
  for (const company of selected) {
    try {
      const response = await fetch(`${origin}/api/monitor?company=${encodeURIComponent(company.name)}`, {
        cache: "no-store",
        headers: { authorization: `Bearer ${secret}` },
      });
      const data = await response.json().catch(() => ({}));
      results.push({
        company: company.name,
        status: response.status,
        change: data.change || null,
        persistence: data.persistence?.status || null,
        errors: data.errors || [],
      });
    } catch (error) {
      results.push({
        company: company.name,
        status: 500,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    batchIndex,
    batchCount,
    selected: selected.length,
    processed: results.length,
    results,
  });
}

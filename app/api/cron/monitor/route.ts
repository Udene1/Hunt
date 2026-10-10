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

  // Run the selected daily batch concurrently. Serial scans could consume the
  // entire 60-second cron budget before the final companies were attempted.
  const results = await Promise.all(selected.map(async (company) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch(`${origin}/api/monitor?company=${encodeURIComponent(company.name)}`, {
        cache: "no-store",
        signal: controller.signal,
        headers: { authorization: `Bearer ${secret}` },
      });
      const data = await response.json().catch(() => ({}));
      return {
        company: company.name,
        status: response.status,
        change: data.change || null,
        persistence: data.persistence?.status || null,
        errors: data.errors || [],
      };
    } catch (error) {
      return {
        company: company.name,
        status: 500,
        error: error instanceof Error && error.name === "AbortError"
          ? "Company scan exceeded the 45-second cron request budget."
          : error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timeout);
    }
  }));

  return NextResponse.json({
    ok: true,
    batchIndex,
    batchCount,
    selected: selected.length,
    processed: results.length,
    results,
  });
}

import { NextResponse } from "next/server";
import { prisma, databaseConfigured } from "../../../lib/db";
import { findCompany, normalizeCompany } from "../../../lib/companies";

export async function GET(request: Request) {
  const rawCompany = new URL(request.url).searchParams.get("company")?.trim();
  if (!rawCompany) return NextResponse.json({ error: "company is required" }, { status: 400 });
  if (!databaseConfigured()) {
    return NextResponse.json({ company: rawCompany, persistent: false, runs: [], observations: [], signals: [] });
  }

  const seed = findCompany(rawCompany);
  const company = seed?.name || rawCompany;
  const normalized = normalizeCompany(company);

  try {
    const dbCompany = await prisma.company.findUnique({ where: { normalized } });
    if (!dbCompany) {
      return NextResponse.json({ company, persistent: true, runs: [], observations: [], signals: [] });
    }

    const [runs, observations, signals] = await Promise.all([
      prisma.monitoringRun.findMany({
        where: { companyId: dbCompany.id },
        orderBy: { startedAt: "desc" },
        take: 25,
        select: {
          id: true,
          startedAt: true,
          finishedAt: true,
          status: true,
          observationCount: true,
          errorCount: true,
        },
      }),
      prisma.observation.findMany({
        where: { companyId: dbCompany.id },
        orderBy: { observedAt: "desc" },
        take: 100,
        select: {
          id: true,
          source: true,
          type: true,
          category: true,
          title: true,
          url: true,
          fingerprint: true,
          observedAt: true,
          firstSeenAt: true,
          lastSeenAt: true,
          metadata: true,
          status: true,
          missCount: true,
          lastProbeAt: true,
          missingSince: true,
          confirmedRemovedAt: true,
        },
      }),
      prisma.signal.findMany({
        where: { companyId: dbCompany.id },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          score: true,
          headline: true,
          detail: true,
          commercialInterpretation: true,
          createdAt: true,
          runId: true,
        },
      }),
    ]);

    return NextResponse.json({
      company,
      persistent: true,
      observationCount: observations.length,
      runCount: runs.length,
      signalCount: signals.length,
      runs,
      observations,
      signals,
    });
  } catch {
    return NextResponse.json({ company, persistent: false, error: "database unavailable" }, { status: 503 });
  }
}

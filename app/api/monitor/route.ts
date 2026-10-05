import { NextResponse } from "next/server";
import { prisma, databaseConfigured } from "../../../lib/db";
import { findCompany, normalizeCompany } from "../../../lib/companies";
import { collectObservations, type Observation } from "../../../lib/signal-adapters";

async function persist(
  company: string,
  domain: string | null,
  observations: Observation[],
  signal: { score: number; headline: string; detail: string; commercialInterpretation: string } | null,
  errors: string[],
) {
  if (!databaseConfigured()) {
    return {
      status: "not_configured",
      newObservationCount: 0,
      unchangedObservationCount: 0,
      changedObservationCount: 0,
      previousObservationCount: 0,
    };
  }

  const normalized = normalizeCompany(company);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const dbCompany = await tx.company.upsert({
        where: { normalized },
        update: { domain: domain || undefined },
        create: { name: company, normalized, domain },
      });
      const previousObservationCount = await tx.observation.count({ where: { companyId: dbCompany.id } });
      const run = await tx.monitoringRun.create({
        data: { companyId: dbCompany.id, status: "running" },
      });

      let newObservationCount = 0;
      let unchangedObservationCount = 0;
      let changedObservationCount = 0;
      const changedObservations: Observation[] = [];

      for (const observation of observations) {
        const existing = await tx.observation.findUnique({
          where: { companyId_fingerprint: { companyId: dbCompany.id, fingerprint: observation.fingerprint } },
        });
        if (existing) {
          unchangedObservationCount++;
          await tx.observation.update({
            where: { id: existing.id },
            data: { lastSeenAt: new Date(), observedAt: new Date(observation.observedAt), runId: run.id, metadata: observation.metadata },
          });
        } else {
          const priorVersions = await tx.observation.findMany({
            where: {
              companyId: dbCompany.id,
              source: observation.source,
              type: observation.type,
              url: observation.url,
            },
            select: { id: true },
            take: 1,
          });
          if (priorVersions.length) {
            changedObservationCount++;
            changedObservations.push(observation);
          }

          await tx.observation.create({
            data: {
              companyId: dbCompany.id,
              runId: run.id,
              source: observation.source,
              type: observation.type,
              category: observation.category,
              title: observation.title,
              url: observation.url,
              fingerprint: observation.fingerprint,
              observedAt: new Date(observation.observedAt),
              metadata: observation.metadata,
            },
          });
          newObservationCount++;
        }
      }

      const recent = await tx.observation.findMany({
        where: {
          companyId: dbCompany.id,
          observedAt: { gte: new Date(Date.now() - 30 * 86400000) },
        },
        select: { category: true, type: true },
        take: 200,
      });
      const changedCategories = Array.from(new Set([
        ...observations
          .filter((observation) => changedObservations.some((changed) => changed.fingerprint === observation.fingerprint))
          .map((observation) => observation.category),
      ]));
      const recentCategories = Array.from(new Set(recent.map((observation) => observation.category)));
      const clusterCategories = Array.from(new Set([...changedCategories, ...recentCategories]));
      const clusterStrength = Math.min(3, changedCategories.length) + (clusterCategories.length >= 2 ? 1 : 0);

      if (signal && (newObservationCount > 0 || changedObservationCount > 0)) {
        await tx.signal.create({
          data: {
            companyId: dbCompany.id,
            runId: run.id,
            score: Math.min(99, signal.score + clusterStrength * 4),
            headline: clusterCategories.length >= 2 ? "Cross-signal activity detected" : signal.headline,
            detail: clusterCategories.length >= 2
              ? signal.detail + " Recent evidence spans " + clusterCategories.length + " signal categories."
              : signal.detail,
            commercialInterpretation: signal.commercialInterpretation,
          },
        });
      }

      await tx.monitoringRun.update({
        where: { id: run.id },
        data: {
          finishedAt: new Date(),
          status: errors.length ? "completed_with_errors" : "completed",
          observationCount: observations.length,
          errorCount: errors.length,
        },
      });

      return {
        status: "persisted",
        newObservationCount,
        unchangedObservationCount,
        changedObservationCount,
        previousObservationCount,
        changedCategories,
        clusterCategories,
      };
    });
    return result;
  } catch (error) {
    console.error(
      "Hunt persistence error",
      error instanceof Error ? error.message : String(error),
    );
    return {
      status: "database_error",
      newObservationCount: 0,
      unchangedObservationCount: 0,
      changedObservationCount: 0,
      previousObservationCount: 0,
      changedCategories: [],
      clusterCategories: [],
    };
  }
}


export async function GET(request: Request) {
  const rawCompany = new URL(request.url).searchParams.get("company")?.trim();
  if (!rawCompany) return NextResponse.json({ error: "company is required" }, { status: 400 });

  const seed = findCompany(rawCompany);
  const company = seed?.name || rawCompany;
  const domain = seed?.domain || null;
  const observations: Observation[] = [];
  const errors: string[] = [];

  const collected = await collectObservations(company, domain);

  const unique = Array.from(new Map(collected.observations.map((x) => [x.fingerprint, x])).values());
  const categories = Array.from(new Set(unique.map((x) => x.category)));
  const jobCount = unique.filter((x) => x.type === "job").length;
  const websiteCount = unique.filter((x) => x.type === "website").length;

  const signal = unique.length
    ? {
        score: Math.min(98, 52 + Math.min(jobCount, 8) * 4 + Math.min(websiteCount, 1) * 7 + Math.max(categories.length - 1, 0) * 5),
        headline: categories.length > 1 ? "Multi-signal activity detected" : categories[0] + " activity",
        detail: unique.length + " public observation" + (unique.length === 1 ? "" : "s") + " collected across " + (categories.length > 1 ? categories.length + " signal categories." : "the available signal source."),
        commercialInterpretation: categories.includes("Engineering / infrastructure")
          ? "Potential engineering, infrastructure or delivery capacity demand"
          : categories.includes("Security / compliance")
            ? "Potential security, compliance or reliability demand"
            : categories.includes("Commercial")
              ? "Potential revenue, partnership or go-to-market demand"
              : categories.includes("Product / operations")
                ? "Potential product, implementation or operational demand"
                : categories.includes("Website / product")
                  ? "Website evidence captured; persistence will determine whether a product change occurred"
                  : "Potential commercial or operational demand",
      }
    : null;

  const persistence = await persist(company, domain, unique, signal, collected.errors);
  const changeDetected = persistence.status === "persisted"
    ? persistence.newObservationCount > 0 || persistence.changedObservationCount > 0
    : null;

  return NextResponse.json({
    company,
    monitoredAt: new Date().toISOString(),
    sources: { adapters: collected.adapters, jobs: ["Remotive", "Arbeitnow"], website: domain },
    baseline: {
      observationCount: unique.length,
      categories,
      established: persistence.previousObservationCount > 0 || unique.length > 0,
    },
    change: {
      detected: changeDetected,
      newObservationCount: persistence.newObservationCount,
      unchangedObservationCount: persistence.unchangedObservationCount,
      changedObservationCount: persistence.changedObservationCount,
      previousObservationCount: persistence.previousObservationCount,
    },
    signal,
    observations: unique.slice(0, 30),
    errors: collected.errors,
    persistence: {
      status: persistence.status,
      note: persistence.status === "persisted"
        ? "Historical observations and fingerprints are now durable."
        : "Set DATABASE_URL to enable durable historical state.",
    },
  });
}

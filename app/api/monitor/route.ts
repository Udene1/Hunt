import { NextResponse } from "next/server";
import { prisma, databaseConfigured } from "../../../lib/db";
import { findCompany, normalizeCompany } from "../../../lib/companies";
import { collectObservations, type Observation } from "../../../lib/signal-adapters";
import { requireMonitoringAccess } from "../../../lib/entitlements";
import type { SurfaceProbe } from "../../../lib/product-surfaces";

async function persist(
  company: string,
  domain: string | null,
  observations: Observation[],
  signal: { score: number; headline: string; detail: string; commercialInterpretation: string } | null,
  errors: string[],
  probes: SurfaceProbe[],
) {
  if (!databaseConfigured()) {
    return {
      status: "not_configured",
      newObservationCount: 0,
      unchangedObservationCount: 0,
      changedObservationCount: 0,
      previousObservationCount: 0,
      lifecycleEvents: [],
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
      const baselineObservations = await tx.observation.findMany({
        where: {
          companyId: dbCompany.id,
          observedAt: { gte: new Date(Date.now() - 30 * 86400000) },
        },
        select: { category: true, type: true },
        take: 200,
      });
      const baselineCategories = Array.from(new Set(baselineObservations.map((observation) => observation.category)));
      const run = await tx.monitoringRun.create({
        data: { companyId: dbCompany.id, status: "running" },
      });
      const priorSurfaceObservations = await tx.observation.findMany({
        where: { companyId: dbCompany.id, source: "Official public surface" },
        orderBy: { observedAt: "desc" },
        take: 500,
      });
      const latestSurfaceByIdentity = new Map<string, typeof priorSurfaceObservations[number]>();
      for (const row of priorSurfaceObservations) {
        const metadata = row.metadata;
        const identity = metadata && typeof metadata === "object" && !Array.isArray(metadata)
          ? String((metadata as Record<string, unknown>).surfaceIdentity || "")
          : "";
        if (identity && !latestSurfaceByIdentity.has(identity)) latestSurfaceByIdentity.set(identity, row);
      }

      let newObservationCount = 0;
      let unchangedObservationCount = 0;
      let changedObservationCount = 0;
      const changedObservations: Observation[] = [];
      const lifecycleEvents: Array<{
        kind: "removed" | "restored" | "moved";
        probe: SurfaceProbe;
        observationId: string;
        missCount?: number;
      }> = [];

      for (const observation of observations) {
        const existing = await tx.observation.findUnique({
          where: { companyId_fingerprint: { companyId: dbCompany.id, fingerprint: observation.fingerprint } },
        });
        if (existing) {
          const priorStatus = existing.status;
          const classificationChanged =
            existing.category !== observation.category ||
            existing.title !== observation.title ||
            existing.source !== observation.source ||
            existing.url !== observation.url;

          if (classificationChanged) {
            changedObservationCount++;
            changedObservations.push(observation);
          } else {
            unchangedObservationCount++;
          }

          await tx.observation.update({
            where: { id: existing.id },
            data: {
              lastSeenAt: new Date(),
              observedAt: new Date(observation.observedAt),
              runId: run.id,
              source: observation.source,
              type: observation.type,
              category: observation.category,
              title: observation.title,
              url: observation.url,
              metadata: observation.metadata,
              status: "active",
              missCount: 0,
              lastProbeAt: observation.source === "Official public surface" ? new Date() : existing.lastProbeAt,
              missingSince: observation.source === "Official public surface" ? null : existing.missingSince,
              confirmedRemovedAt: observation.source === "Official public surface" ? null : existing.confirmedRemovedAt,
            },
          });
          const identity = observation.metadata && "surfaceIdentity" in observation.metadata
            ? String(observation.metadata.surfaceIdentity || "")
            : "";
          if (identity && priorStatus === "confirmed_removed") {
            const probe = probes.find((item) => item.surfaceIdentity === identity && item.status === "present");
            if (probe) lifecycleEvents.push({ kind: "restored", probe, observationId: existing.id });
          }
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

          const created = await tx.observation.create({
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
              status: "active",
              missCount: 0,
              lastProbeAt: observation.source === "Official public surface" ? new Date() : null,
            },
          });
          const identity = observation.metadata && "surfaceIdentity" in observation.metadata
            ? String(observation.metadata.surfaceIdentity || "")
            : "";
          const priorSurface = identity ? latestSurfaceByIdentity.get(identity) : undefined;
          if (identity && priorSurface?.status === "confirmed_removed") {
            const probe = probes.find((item) => item.surfaceIdentity === identity && item.status === "present");
            if (probe) lifecycleEvents.push({ kind: "restored", probe, observationId: created.id });
          }
          newObservationCount++;
        }
      }

      for (const probe of probes.filter((item) => item.status === "missing")) {
        const latest = latestSurfaceByIdentity.get(probe.surfaceIdentity);
        if (!latest || latest.status === "confirmed_removed") continue;

        const nextMissCount = latest.missCount + 1;
        const confirmed = nextMissCount >= 2;
        await tx.observation.update({
          where: { id: latest.id },
          data: {
            status: confirmed ? "confirmed_removed" : "suspected_missing",
            missCount: nextMissCount,
            lastProbeAt: new Date(probe.checkedAt),
            missingSince: latest.missingSince || new Date(probe.checkedAt),
            confirmedRemovedAt: confirmed ? new Date(probe.checkedAt) : null,
            runId: run.id,
          },
        });
        if (confirmed) {
          lifecycleEvents.push({
            kind: "removed",
            probe,
            observationId: latest.id,
            missCount: nextMissCount,
          });
        }
      }

      const changedCategories = Array.from(new Set(
        changedObservations.map((observation) => observation.category),
      ));
      const currentCategories = Array.from(new Set(
        observations
          .filter((observation) => changedObservations.some((changed) => changed.fingerprint === observation.fingerprint))
          .map((observation) => observation.category),
      ));
      const historicalIntersection = currentCategories.filter((category) => baselineCategories.includes(category));
      const clusterCategories = Array.from(new Set([...currentCategories, ...historicalIntersection]));
      const hasHistoricalBaseline = previousObservationCount > 0;
      const crossSignal = hasHistoricalBaseline && (
        currentCategories.length >= 2 || historicalIntersection.length > 0
      );
      const clusterStrength = crossSignal ? Math.min(3, currentCategories.length) + 1 : 0;

      if (signal && (newObservationCount > 0 || changedObservationCount > 0)) {
        await tx.signal.create({
          data: {
            companyId: dbCompany.id,
            runId: run.id,
            score: Math.min(99, signal.score + clusterStrength * 4),
            headline: crossSignal ? "Cross-signal activity detected" : signal.headline,
            detail: crossSignal
              ? signal.detail + " New evidence intersects " + historicalIntersection.length + " established signal categor" + (historicalIntersection.length === 1 ? "y." : "ies.")
              : signal.detail,
            commercialInterpretation: signal.commercialInterpretation,
          },
        });
      }

      // A disappearing surface plus a newly reachable surface with the same
      // semantic label is more likely a migration than a retirement.
      for (const event of lifecycleEvents.filter((item) => item.kind === "removed")) {
        const replacementProbe = probes.find((probe) =>
          probe.status === "present" &&
          probe.label === event.probe.label &&
          probe.surfaceIdentity !== event.probe.surfaceIdentity
        );
        if (replacementProbe) {
          event.kind = "moved";
          event.probe = replacementProbe;
        }
      }

      for (const event of lifecycleEvents) {
        const removed = event.kind === "removed";
        const moved = event.kind === "moved";
        await tx.signal.create({
          data: {
            companyId: dbCompany.id,
            runId: run.id,
            score: removed ? 68 : moved ? 74 : 56,
            headline: removed
              ? "Public product surface removed"
              : moved
                ? "Public product surface migrated"
                : "Public product surface restored",
            detail: removed
              ? event.probe.label + " at " + event.probe.path + " returned " + event.probe.httpStatus + " on two consecutive monitoring runs. The surface was previously observed and is now treated as historically removed."
              : moved
                ? event.probe.label + " changed public location while another surface with the same label became reachable. Treat this as a likely migration rather than a confirmed retirement."
                : event.probe.label + " at " + event.probe.path + " became reachable again after a confirmed removal state. Investigate whether the surface was restored, migrated, or replaced.",
            commercialInterpretation: removed
              ? "Historical product/API change; investigate whether the capability was retired, migrated or replaced"
              : moved
                ? "Potential product/API migration; investigate the replacement surface, documentation changes and integration impact"
                : "Historical product/API restoration; investigate the current surface and any migration or relaunch",
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
        baselineCategories,
        historicalIntersection,
        crossSignal,
        lifecycleEvents: lifecycleEvents.map((event) => ({
          kind: event.kind,
          path: event.probe.path,
          label: event.probe.label,
          status: event.probe.httpStatus,
          missCount: event.missCount || 0,
        })),
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
      lifecycleEvents: [],
    };
  }
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const internal = Boolean(cronSecret && request.headers.get("authorization") === `Bearer ${cronSecret}`);
  if (!internal) {
    const access = await requireMonitoringAccess();
    if (!access.allowed) {
      return NextResponse.json(
        { error: access.reason === "authentication_required" ? "Authentication required." : "Monitoring is available to pilot and paid accounts.", code: access.reason },
        { status: access.reason === "authentication_required" ? 401 : 402 },
      );
    }
  }

  const rawCompany = new URL(request.url).searchParams.get("company")?.trim();
  if (!rawCompany) return NextResponse.json({ error: "company is required" }, { status: 400 });

  const seed = findCompany(rawCompany);
  const company = seed?.name || rawCompany;
  const domain = seed?.domain || null;
  const collected = await collectObservations(company, domain);

  const unique = Array.from(new Map(collected.observations.map((x) => [x.fingerprint, x])).values());
  const categories = Array.from(new Set(unique.map((x) => x.category)));
  const jobCount = unique.filter((x) => x.type === "job").length;
  const websiteCount = unique.filter((x) => x.type === "website").length;
  const procurementCount = unique.filter((x) => x.type === "procurement").length;
  const technologyCount = unique.filter((x) => x.type === "technology").length;
  const productSurfaceCount = unique.filter((x) => x.category === "Product / API surface").length;
  const githubCount = unique.filter((x) => x.source === "GitHub").length;
  const githubVelocityCount = unique.filter((x) => x.category === "Engineering / GitHub velocity").length;

  const signal = unique.length
    ? {
        score: Math.min(98, 52 + Math.min(jobCount, 8) * 4 + Math.min(websiteCount, 1) * 7 + Math.min(procurementCount, 4) * 6 + Math.min(technologyCount, 6) * 4 + Math.min(productSurfaceCount, 4) * 5 + Math.min(githubCount, 6) * 3 + Math.min(githubVelocityCount, 3) * 4 + Math.max(categories.length - 1, 0) * 5),
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
                : categories.includes("Procurement")
                  ? "Potential supplier, implementation, procurement or contract demand"
                  : categories.includes("Technology / infrastructure")
                    ? "Potential platform, infrastructure, API, integration or technical delivery demand"
                    : categories.includes("Product / API surface")
                      ? "Potential API, integration, developer-platform or technical delivery demand"
                    : categories.includes("Product / release")
                      ? "Potential product release, integration or technical delivery demand"
                    : categories.includes("Engineering / GitHub velocity")
                      ? "Potential engineering, platform or developer-ecosystem demand; investigate whether engineering activity is accelerating"
                    : categories.includes("Engineering / GitHub activity")
                      ? "Potential engineering, platform or developer-ecosystem demand"
                    : categories.includes("Website / product")
                      ? "Website evidence captured; persistence will determine whether a product change occurred"
                      : "Potential commercial or operational demand",
      }
    : null;

  const persistence = await persist(company, domain, unique, signal, collected.errors, collected.probes || []);
  const changeDetected = persistence.status === "persisted"
    ? persistence.newObservationCount > 0 || persistence.changedObservationCount > 0 || (persistence.lifecycleEvents?.length || 0) > 0
    : null;

  return NextResponse.json({
    company,
    monitoredAt: new Date().toISOString(),
    sources: { adapters: collected.adapters, website: domain },
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
      lifecycleEventCount: persistence.lifecycleEvents?.length || 0,
    },
    lifecycle: persistence.lifecycleEvents || [],
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

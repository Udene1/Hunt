import { NextResponse } from "next/server";
import { prisma, databaseConfigured } from "../../../lib/db";
import { findCompany, normalizeCompany } from "../../../lib/companies";
import { discoverCompanyDomain } from "../../../lib/company-discovery";
import { collectObservations, type Observation } from "../../../lib/signal-adapters";
import { requireMonitoringAccess } from "../../../lib/entitlements";
import type { SurfaceProbe } from "../../../lib/product-surfaces";
import { scoreCompanyRelevance } from "../../../lib/relevance";
import { createAdminReviewTasks, pushAdminReviewAlert } from "../../../lib/admin-review";
import { correlateEvidence } from "../../../lib/evidence-correlation";

type PersistenceResult = {
  status: "persisted" | "not_configured" | "database_error";
  newObservationCount: number;
  unchangedObservationCount: number;
  changedObservationCount: number;
  previousObservationCount: number;
  changedCategories: string[];
  clusterCategories: string[];
  baselineCategories: string[];
  historicalIntersection: string[];
  crossSignal: boolean;
  cluster: { id: string; created: boolean } | null;
  opportunityCount: number;
  lifecycleEvents: Array<{
    kind: "removed" | "restored" | "moved";
    path: string;
    label: string;
    status: number | null;
    missCount: number;
  }>;
};

async function persist(
  company: string,
  domain: string | null,
  observations: Observation[],
  signal: { score: number; headline: string; detail: string; commercialInterpretation: string } | null,
  errors: string[],
  probes: SurfaceProbe[],
  contacts: import("../../../lib/company-people-finance").DiscoveredContact[],
  financials: import("../../../lib/company-people-finance").DiscoveredFinancialRecord[],
  reviewIssues: import("../../../lib/financial-document-extractor").FinancialDocumentIssue[] = [],
): Promise<PersistenceResult> {
  if (!databaseConfigured()) {
    return {
      status: "not_configured",
      newObservationCount: 0,
      unchangedObservationCount: 0,
      changedObservationCount: 0,
      previousObservationCount: 0,
      changedCategories: [],
      clusterCategories: [],
      baselineCategories: [],
      historicalIntersection: [],
      crossSignal: false,
      cluster: null,
      opportunityCount: 0,
      lifecycleEvents: [],
    };
  }

  const normalized = normalizeCompany(company);
  try {
    const result = await prisma.$transaction(async (tx): Promise<PersistenceResult> => {
      const dbCompany = await tx.company.upsert({
        where: { normalized },
        update: { domain: domain || undefined },
        create: { name: company, normalized, domain },
      });
      const priorContacts = await tx.companyContact.findMany({ where: { companyId: dbCompany.id }, select: { name: true, role: true } });
      for (const contact of contacts) {
        await tx.companyContact.upsert({
          where: { companyId_name_role: { companyId: dbCompany.id, name: contact.name, role: contact.role || "" } },
          update: {
            email: contact.email, phone: contact.phone, linkedinUrl: contact.linkedinUrl,
            source: contact.source, sourceUrl: contact.sourceUrl, confidence: contact.confidence, verificationStatus: contact.verificationStatus,
            lastSeenAt: new Date(),
          },
          create: {
            companyId: dbCompany.id, name: contact.name, role: contact.role || "",
            email: contact.email, phone: contact.phone, linkedinUrl: contact.linkedinUrl,
            source: contact.source, sourceUrl: contact.sourceUrl, confidence: contact.confidence, verificationStatus: contact.verificationStatus,
          },
        });
      }
      for (const financial of financials) {
        await tx.financialRecord.upsert({
          where: {
            companyId_period_statementType_source: {
              companyId: dbCompany.id, period: financial.period,
              statementType: financial.statementType, source: financial.source,
            },
          },
          update: {
            currency: financial.currency, sourceUrl: financial.sourceUrl,
            publishedAt: financial.publishedAt ? new Date(financial.publishedAt) : null,
            observedAt: new Date(), summary: financial.summary,
            metrics: financial.metrics == null ? undefined : JSON.parse(JSON.stringify(financial.metrics)),
            confidence: financial.confidence, verificationStatus: financial.verificationStatus,
          },
          create: {
            companyId: dbCompany.id, period: financial.period,
            statementType: financial.statementType, currency: financial.currency,
            source: financial.source, sourceUrl: financial.sourceUrl,
            publishedAt: financial.publishedAt ? new Date(financial.publishedAt) : null,
            observedAt: new Date(), summary: financial.summary,
            metrics: financial.metrics == null ? undefined : JSON.parse(JSON.stringify(financial.metrics)),
            confidence: financial.confidence, verificationStatus: financial.verificationStatus,
          },
        });
      }

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
      for (const contact of contacts) {
        if (!contact.role) continue;
        const previousRoles = priorContacts
          .filter((item) => item.name.trim().toLowerCase() === contact.name.trim().toLowerCase())
          .map((item) => item.role.trim())
          .filter(Boolean);
        const changedFrom = previousRoles.find((role) => role.toLowerCase() !== contact.role!.trim().toLowerCase());
        if (changedFrom) {
          const fingerprint = "leadership-movement|" + contact.name.trim().toLowerCase() + "|" + changedFrom.toLowerCase() + "|" + contact.role.trim().toLowerCase();
          observations.push({
            source: contact.source,
            type: "leadership",
            title: contact.name + " role changed from " + changedFrom + " to " + contact.role,
            category: "Leadership / key people movement",
            url: contact.sourceUrl,
            observedAt: new Date().toISOString(),
            fingerprint,
            metadata: { person: contact.name, previousRole: changedFrom, currentRole: contact.role, verificationStatus: contact.verificationStatus },
          });
        }
      }
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
          const existingMetadata = existing.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata)
            ? existing.metadata as Record<string, unknown>
            : {};
          const nextMetadata = observation.metadata && typeof observation.metadata === "object"
            ? observation.metadata as Record<string, unknown>
            : {};
          const contentChanged = Boolean(
            existingMetadata.contentHash &&
            nextMetadata.contentHash &&
            existingMetadata.contentHash !== nextMetadata.contentHash
          );
          const classificationChanged =
            existing.category !== observation.category ||
            existing.title !== observation.title ||
            existing.source !== observation.source ||
            existing.url !== observation.url ||
            contentChanged;

          if (classificationChanged) {
            changedObservationCount++;
            changedObservations.push(observation);
          } else {
            unchangedObservationCount++;
          }

          const sourceTier = observation.source.toLowerCase().includes("regulator") || /cbn|sec|cac|ndpc|nitda|fccpc/i.test(observation.source) ? "authoritative" : /official|github|company/i.test(observation.source) ? "first_party" : "secondary";
          const verificationStatus = observation.url ? "reachable" : "unverified";
          const entityConfidence = observation.source === "Official website" || observation.source === "GitHub" ? 90 : 70;
          const evidenceConfidence = sourceTier === "authoritative" ? 95 : sourceTier === "first_party" ? 85 : 65;
          if (classificationChanged) {
            await tx.observationRevision.create({
              data: {
                observationId: existing.id,
                runId: existing.runId,
                source: existing.source,
                type: existing.type,
                category: existing.category,
                title: existing.title,
                url: existing.url,
                fingerprint: existing.fingerprint,
                observedAt: existing.observedAt,
                metadata: existing.metadata,
                sourceTier: existing.sourceTier,
                verificationStatus: existing.verificationStatus,
                entityConfidence: existing.entityConfidence,
                evidenceConfidence: existing.evidenceConfidence,
              },
            });
          }
          await tx.observation.update({
            where: { id: existing.id },
            data: {
              sourceTier, verificationStatus, entityConfidence, evidenceConfidence,
              lastSeenAt: new Date(),
              observedAt: new Date(observation.observedAt),
              runId: run.id,
              source: observation.source,
              type: observation.type,
              category: observation.category,
              title: observation.title,
              url: observation.url,
              metadata: observation.metadata ? { ...observation.metadata, changeKind: classificationChanged ? "changed" : "unchanged" } : { changeKind: classificationChanged ? "changed" : "unchanged" }, status: "active",
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

          const sourceTier = observation.source.toLowerCase().includes("regulator") || /cbn|sec|cac|ndpc|nitda|fccpc/i.test(observation.source) ? "authoritative" : /official|github|company/i.test(observation.source) ? "first_party" : "secondary";
          const verificationStatus = observation.url ? "reachable" : "unverified";
          const entityConfidence = observation.source === "Official website" || observation.source === "GitHub" ? 90 : 70;
          const evidenceConfidence = sourceTier === "authoritative" ? 95 : sourceTier === "first_party" ? 85 : 65;
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
              sourceTier,
              verificationStatus,
              entityConfidence,
              evidenceConfidence,
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
            headline: crossSignal ? "Cross-signal evidence detected" : signal.headline,
            detail: crossSignal
              ? signal.detail + " New evidence intersects " + historicalIntersection.length + " established signal categor" + (historicalIntersection.length === 1 ? "y." : "ies.") + " Review the underlying evidence; Hunt does not determine the commercial conclusion."
              : signal.detail + " Review the underlying evidence before drawing a conclusion.",
            commercialInterpretation: "Investigation input only: inspect the underlying evidence, changes, source independence and uncertainty before drawing a commercial conclusion.",
          },
        });
      }

      let clusterCreated = false;
      let clusterId: string | null = null;
      let opportunityCount = 0;
      const recentEvidence = await tx.observation.findMany({
        where: {
          companyId: dbCompany.id,
          observedAt: { gte: new Date(Date.now() - 14 * 86400000) },
          status: { not: "confirmed_removed" },
        },
        select: {
          id: true, title: true, category: true, source: true, type: true, url: true,
          observedAt: true, metadata: true, sourceTier: true, verificationStatus: true,
          evidenceConfidence: true,
        },
        orderBy: { observedAt: "desc" },
        take: 120,
      });
      const changedEvidence = recentEvidence.filter((item) => {
        const metadata = item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
          ? item.metadata as Record<string, unknown>
          : {};
        return metadata.changeKind === "new" || metadata.changeKind === "changed";
      });
      const correlation = correlateEvidence(changedEvidence.length >= 2 ? changedEvidence : recentEvidence);

      if (correlation && hasHistoricalBaseline) {
        const clusterScore = correlation.score;
        const clusterCategorySet = correlation.categories;
        const clusterEvidenceIds = correlation.evidenceIds;
        const clusterHeadline = correlation.headline;
        const clusterDetail = correlation.detail + " Hunt stores the evidence; an external investigator decides what it means commercially.";
        const cluster = await tx.signalCluster.upsert({
          where: { companyId_fingerprint: { companyId: dbCompany.id, fingerprint: correlation.fingerprint } },
          update: {
            runId: run.id, score: clusterScore, headline: clusterHeadline, detail: clusterDetail,
            categories: clusterCategorySet, evidenceIds: clusterEvidenceIds,
            windowStart: correlation.windowStart, windowEnd: correlation.windowEnd, lastSeenAt: new Date(),
          },
          create: {
            companyId: dbCompany.id, runId: run.id, fingerprint: correlation.fingerprint, score: clusterScore,
            headline: clusterHeadline, detail: clusterDetail, categories: clusterCategorySet,
            evidenceIds: clusterEvidenceIds, windowStart: correlation.windowStart, windowEnd: correlation.windowEnd,
          },
        });
        clusterId = cluster.id;
        clusterCreated = cluster.createdAt.getTime() >= run.startedAt.getTime() - 1000;
        const watchedUsers = await tx.user.findMany({
          where: { userWatches: { some: { companyId: dbCompany.id } } },
          include: { profile: true },
        });
        for (const watchedUser of watchedUsers) {
          const watch = await tx.userWatch.findUnique({ where: { userId_companyId: { userId: watchedUser.id, companyId: dbCompany.id } } });
          const allowedTypes = Array.isArray(watch?.signalTypes) ? (watch?.signalTypes as string[]) : [];
          const filteredClusterEvidence = allowedTypes.length ? clusterEvidence.filter((item) => allowedTypes.some((type) => item.category.toLowerCase().includes(type.toLowerCase()) || item.type.toLowerCase() === type.toLowerCase())) : clusterEvidence;
          if (allowedTypes.length && filteredClusterEvidence.length === 0) continue;
          const relevance = scoreCompanyRelevance(
            watchedUser.profile || {},
            dbCompany,
            clusterEvidence.map((item) => ({ ...item, observedAt: item.observedAt })),
          );
          if (relevance.score < Math.max(20, watch?.minScore || 20) || relevance.confidence === "none") continue;
          const candidateFingerprint = clusterFingerprint + "|" + cluster.id;
          const existingCandidate = await tx.opportunityCandidate.findUnique({
            where: { userId_fingerprint: { userId: watchedUser.id, fingerprint: candidateFingerprint } },
          });
          const candidate = await tx.opportunityCandidate.upsert({
            where: { userId_fingerprint: { userId: watchedUser.id, fingerprint: candidateFingerprint } },
            update: { score: Math.min(99, Math.round((clusterScore + relevance.score) / 2)), reason: "A durable signal intersection matches the user's configured commercial objectives. Hunt does not decide whether the lead should be contacted.", evidenceIds: clusterEvidenceIds },
            create: { userId: watchedUser.id, companyId: dbCompany.id, clusterId: cluster.id, fingerprint: candidateFingerprint, score: Math.min(99, Math.round((clusterScore + relevance.score) / 2)), reason: "A durable signal intersection matches the user's configured commercial objectives. Hunt does not decide whether the lead should be contacted.", evidenceIds: clusterEvidenceIds },
          });
          opportunityCount++;
          if (!existingCandidate) {
            await tx.notification.create({
              data: {
                userId: watchedUser.id,
                companyId: dbCompany.id,
                clusterId: cluster.id,
                opportunityId: candidate.id,
                type: "opportunity_candidate",
                title: dbCompany.name + " has a relevant signal intersection",
                body: clusterHeadline + ". Review the evidence before deciding whether to investigate or contact.",
              },
            });
          }
        }
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
        cluster: clusterId ? { id: clusterId, created: clusterCreated } : null,
        opportunityCount,
        lifecycleEvents: lifecycleEvents.map((event) => ({
          kind: event.kind,
          path: event.probe.path,
          label: event.probe.label,
          status: event.probe.httpStatus,
          missCount: event.missCount || 0,
        })),
      };
    });
    if (reviewIssues.length) {
      try {
        const companyRecord = await prisma.company.findUnique({ where: { normalized }, select: { id: true } });
        if (companyRecord) {
          const tasks = await createAdminReviewTasks(reviewIssues.map((issue) => ({ ...issue, companyId: companyRecord.id, title: company + ": " + issue.title })));
          for (const task of tasks) await pushAdminReviewAlert(task).catch(() => {});
        }
      } catch (reviewError) {
        console.error("Hunt admin review task error", reviewError instanceof Error ? reviewError.message : String(reviewError));
      }
    }
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
      baselineCategories: [],
      historicalIntersection: [],
      crossSignal: false,
      cluster: null,
      opportunityCount: 0,
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
  const cleanedTarget = rawCompany
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]
    .trim();
  const domainCandidate = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z]{2,}(?:\.[a-z]{2,})?$/i.test(cleanedTarget)
    ? cleanedTarget.toLowerCase()
    : null;
  const discovered = seed || domainCandidate
    ? { name: seed?.name || (domainCandidate ? cleanedTarget.split(".")[0].replace(/[-_]+/g, " ") : rawCompany), domain: seed?.domain || domainCandidate, source: seed ? "catalogue" as const : "input" as const }
    : await discoverCompanyDomain(rawCompany);
  const company = discovered.name;
  const domain = discovered.domain;
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
        commercialInterpretation: "Investigation required: Hunt records public evidence and observed change. It does not infer a commercial need from signal category alone.",
      }
    : null;

  const persistence = await persist(company, domain, unique, signal, collected.errors, collected.probes || [], collected.contacts || [], collected.financials || [], collected.reviewIssues || []);
  const changeDetected = persistence.status === "persisted"
    ? persistence.newObservationCount > 0 || persistence.changedObservationCount > 0 || (persistence.lifecycleEvents?.length || 0) > 0
    : null;

  return NextResponse.json({
    company,
    monitoredAt: new Date().toISOString(),
    sources: { adapters: collected.adapters, website: domain, domainDiscovery: discovered.source },
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
    cluster: persistence.cluster || null,
    opportunityCount: persistence.opportunityCount || 0,
    signal,
    contacts: (collected.contacts || []).slice(0, 20),
    financials: (collected.financials || []).slice(0, 20),
    observations: unique.slice(0, 30),
    errors: collected.errors,
    adminReview: (collected.reviewIssues || []).map((issue) => ({ type: issue.type, title: issue.title, sourceUrl: issue.sourceUrl })),
    persistence: {
      status: persistence.status,
      note: persistence.status === "persisted"
        ? "Historical observations and fingerprints are now durable."
        : "Set DATABASE_URL to enable durable historical state.",
    },
  });
}

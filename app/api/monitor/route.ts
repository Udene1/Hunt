import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma, databaseConfigured } from "../../../lib/db";
import { COMPANY_CATALOG, findCompany, normalizeCompany } from "../../../lib/companies";
import { discoverCompanyDomain } from "../../../lib/company-discovery";
import { collectObservations, type Observation } from "../../../lib/signal-adapters";
import { requireMonitoringAccess } from "../../../lib/entitlements";
import type { SurfaceProbe } from "../../../lib/product-surfaces";
import { scoreCompanyRelevance } from "../../../lib/relevance";
import { createAdminReviewTasks, pushAdminReviewAlert } from "../../../lib/admin-review";
import { correlateEvidence, sourceFamily } from "../../../lib/evidence-correlation";

function classifyObservationQuality(observation: Observation, canonicalDomain: string | null) {
  const metadata = observation.metadata || {};
  const source = observation.source.toLowerCase();
  const templateSuspected = metadata.templateSuspected === true || source.includes("template suspected");
  let exactCanonicalHostMatch = false;
  try {
    if (observation.url && canonicalDomain) {
      const observedHost = new URL(observation.url).hostname.toLowerCase().replace(/^www\./, "");
      const domainUrl = canonicalDomain.includes("://") ? canonicalDomain : "https://" + canonicalDomain;
      const canonicalHost = new URL(domainUrl).hostname.toLowerCase().replace(/^www\./, "");
      exactCanonicalHostMatch = observedHost === canonicalHost;
    }
  } catch { exactCanonicalHostMatch = false; }
  const sourceTier = source.includes("regulator") || /cbn|sec|cac|ndpc|nitda|fccpc/i.test(observation.source)
    ? "authoritative"
    : ((exactCanonicalHostMatch && !templateSuspected) || /official|github|company/i.test(observation.source))
      ? "first_party" : "secondary";
  const entityIdentityVerified = metadata.entityIdentityVerified === true || (exactCanonicalHostMatch && !templateSuspected);
  const entityConfidence = entityIdentityVerified ? 90 : sourceTier === "authoritative" ? 65 : observation.source === "Official website" ? 55 : 40;
  const evidenceConfidence = sourceTier === "authoritative" ? 95 : sourceTier === "first_party" ? 85 : 65;
  const verificationStatus = templateSuspected ? "template_suspected" : observation.url ? "reachable" : "unverified";
  const enrichedMetadata: Observation["metadata"] = {
    ...metadata,
    ...(exactCanonicalHostMatch && !templateSuspected ? {
      entityIdentityVerified: true,
      entityIdentityBasis: "exact_canonical_hostname_match",
      claimVerificationStatus: "source_observed_not_independently_verified",
    } : {}),
  };
  return { sourceTier, entityConfidence, evidenceConfidence, verificationStatus, metadata: enrichedMetadata };
}

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
  // The curated catalogue is the canonical identity source for known entities.
  // A later scan must never overwrite Dangote Refinery's canonical host with a
  // stale or guessed domain from a previous record.
  const canonicalDomain = findCompany(company)?.domain || domain;
  try {
    const result = await prisma.$transaction(async (tx): Promise<PersistenceResult> => {
      const dbCompany = await tx.company.upsert({
        where: { normalized },
        update: { domain: canonicalDomain || undefined },
        create: { name: company, normalized, domain: canonicalDomain },
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

          const quality = classifyObservationQuality(observation, canonicalDomain);
          const { sourceTier, verificationStatus, entityConfidence, evidenceConfidence } = quality;
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
                metadata: existing.metadata ?? Prisma.JsonNull,
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
              observedAt: classificationChanged ? new Date(observation.observedAt) : existing.observedAt,
              runId: run.id,
              source: observation.source,
              type: observation.type,
              category: observation.category,
              title: observation.title,
              url: observation.url,
              metadata: { ...quality.metadata, changeKind: classificationChanged ? "changed" : "unchanged" }, status: "active",
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

          const quality = classifyObservationQuality(observation, canonicalDomain);
          const { sourceTier, verificationStatus, entityConfidence, evidenceConfidence } = quality;
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
              metadata: quality.metadata,
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
      const changedSourceFamilies = Array.from(new Set(
        changedObservations.map((observation) => sourceFamily(observation.source, observation.url)),
      ));
      const crossSignal = hasHistoricalBaseline && currentCategories.length >= 2 && changedSourceFamilies.length >= 2;
      const clusterStrength = crossSignal ? Math.min(3, currentCategories.length) + 1 : 0;

      if (signal && (newObservationCount > 0 || changedObservationCount > 0)) {
        await tx.signal.create({
          data: {
            companyId: dbCompany.id,
            runId: run.id,
            score: Math.min(99, signal.score + clusterStrength * 4),
            headline: crossSignal ? "Cross-signal evidence detected" : signal.headline,
            detail: crossSignal
              ? signal.detail + " New changed evidence spans " + changedSourceFamilies.length + " source families and intersects " + historicalIntersection.length + " established categor" + (historicalIntersection.length === 1 ? "y." : "ies.") + " Review the underlying evidence; Hunt does not determine the commercial conclusion."
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
      const correlation = correlateEvidence(changedEvidence);

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
        clusterCreated = cluster.firstSeenAt.getTime() >= run.startedAt.getTime() - 1000;
        const clusterEvidence = recentEvidence.filter((item) => correlation.evidenceIds.includes(item.id));
        const clusterFingerprint = correlation.fingerprint;
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
  // Do not turn a live search-box fragment into a durable company record.
  // Check both the canonical catalogue and persisted companies; the guard must
  // still work when the database is unavailable or has not indexed a catalogue entry.
  if (!seed && !domainCandidate) {
    const normalizedInput = rawCompany.toLowerCase().replace(/[^a-z0-9]/g, "");
    const catalogueMatches = COMPANY_CATALOG
      .filter((item) => {
        const normalizedName = item.name.toLowerCase().replace(/[^a-z0-9]/g, "");
        return normalizedName.length > normalizedInput.length && normalizedName.startsWith(normalizedInput);
      })
      .map((item) => ({ name: item.name, domain: item.domain }));
    let persistedMatches: Array<{ name: string; domain: string | null }> = [];
    let exact: { id: string; domain: string | null } | null = null;
    if (databaseConfigured()) {
      try {
        exact = await prisma.company.findFirst({
          where: { name: { equals: rawCompany, mode: "insensitive" } },
          select: { id: true, domain: true },
        });
        persistedMatches = await prisma.company.findMany({
          where: { name: { startsWith: rawCompany, mode: "insensitive" } },
          select: { name: true, domain: true },
          take: 20,
        });
      } catch {
        // The catalogue guard below remains active even if database lookup fails.
      }
    }
    const exactDomainLabel = (exact?.domain || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[./]/)[0].replace(/[^a-z0-9]/g, "");
    const exactHasMatchingDomain = Boolean(exact && exactDomainLabel && exactDomainLabel === normalizedInput);
    const longerMatches = [...catalogueMatches, ...persistedMatches];
    const partialMatches = longerMatches.filter((item) => {
      const normalizedName = item.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      return normalizedName.length > normalizedInput.length && normalizedName.startsWith(normalizedInput);
    });
    const suggestions = Array.from(new Map(partialMatches.map((item) => [item.name.toLowerCase(), item.name])).values());
    if (suggestions.length && !exactHasMatchingDomain) {
      return NextResponse.json({
        error: "This looks like a partial company name. Choose the complete company record before scanning.",
        code: "partial_company_name",
        suggestions,
      }, { status: 409 });
    }
  }
  const discovered = seed || domainCandidate
    ? { name: seed?.name || (domainCandidate ? cleanedTarget.split(".")[0].replace(/[-_]+/g, " ") : rawCompany), domain: seed?.domain || domainCandidate, source: seed ? "catalogue" as const : "input" as const }
    : await discoverCompanyDomain(rawCompany);
  const company = discovered.name;
  const domain = discovered.domain;
  const collected = await collectObservations(company, domain);

  const unique = Array.from(new Map(collected.observations.map((x) => [x.fingerprint, x])).values());
  const categories = Array.from(new Set(unique.map((x) => x.category)));
  const sourceFamilies = Array.from(new Set(unique.map((x) => sourceFamily(x.source, x.url))));
  const recentCount = unique.filter((x) => Date.now() - new Date(x.observedAt).getTime() <= 14 * 86400000).length;
  const verifiedCount = unique.filter((x) => /official|regulator|github|procurement|public web/i.test(x.source)).length;

  const evidenceScore = unique.length
    ? Math.min(
        99,
        30 +
          Math.min(categories.length, 6) * 7 +
          Math.min(sourceFamilies.length, 6) * 6 +
          Math.min(recentCount, 8) * 2 +
          Math.min(verifiedCount, 8),
      )
    : 0;

  const signal = unique.length
    ? {
        score: evidenceScore,
        headline: categories.length > 1 ? "Evidence activity detected" : "Public evidence detected",
        detail:
          unique.length +
          " public observations across " +
          categories.length +
          " evidence categories and " +
          sourceFamilies.length +
          " source families. Review the underlying evidence and observed changes.",
        commercialInterpretation:
          "Investigation input only: Hunt does not infer a commercial need from an evidence category or score.",
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

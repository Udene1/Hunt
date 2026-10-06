-- Hunt signal clusters, deterministic opportunity candidates and notifications
CREATE TABLE IF NOT EXISTS "hunt"."SignalCluster" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "runId" TEXT,
  "fingerprint" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "headline" TEXT NOT NULL,
  "detail" TEXT NOT NULL,
  "categories" JSONB NOT NULL,
  "evidenceIds" JSONB NOT NULL,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SignalCluster_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SignalCluster_companyId_fingerprint_key" ON "hunt"."SignalCluster"("companyId","fingerprint");
CREATE INDEX IF NOT EXISTS "SignalCluster_companyId_lastSeenAt_idx" ON "hunt"."SignalCluster"("companyId","lastSeenAt");
DO $$ BEGIN
  ALTER TABLE "hunt"."SignalCluster" ADD CONSTRAINT "SignalCluster_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "hunt"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "hunt"."SignalCluster" ADD CONSTRAINT "SignalCluster_runId_fkey" FOREIGN KEY ("runId") REFERENCES "hunt"."MonitoringRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "hunt"."OpportunityCandidate" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "clusterId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "evidenceIds" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'new',
  "investigationState" TEXT NOT NULL DEFAULT 'not_investigated',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OpportunityCandidate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "OpportunityCandidate_userId_fingerprint_key" ON "hunt"."OpportunityCandidate"("userId","fingerprint");
CREATE INDEX IF NOT EXISTS "OpportunityCandidate_userId_status_updatedAt_idx" ON "hunt"."OpportunityCandidate"("userId","status","updatedAt");
CREATE INDEX IF NOT EXISTS "OpportunityCandidate_companyId_createdAt_idx" ON "hunt"."OpportunityCandidate"("companyId","createdAt");
DO $$ BEGIN
  ALTER TABLE "hunt"."OpportunityCandidate" ADD CONSTRAINT "OpportunityCandidate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "hunt"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "hunt"."OpportunityCandidate" ADD CONSTRAINT "OpportunityCandidate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "hunt"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "hunt"."OpportunityCandidate" ADD CONSTRAINT "OpportunityCandidate_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "hunt"."SignalCluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "hunt"."Notification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "clusterId" TEXT,
  "opportunityId" TEXT,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Notification_userId_readAt_createdAt_idx" ON "hunt"."Notification"("userId","readAt","createdAt");
DO $$ BEGIN
  ALTER TABLE "hunt"."Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "hunt"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "hunt"."Notification" ADD CONSTRAINT "Notification_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "hunt"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "hunt"."Notification" ADD CONSTRAINT "Notification_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "hunt"."SignalCluster"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "hunt"."Notification" ADD CONSTRAINT "Notification_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "hunt"."OpportunityCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

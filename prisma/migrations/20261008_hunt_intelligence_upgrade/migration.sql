ALTER TABLE "hunt"."Observation" ADD COLUMN "sourceTier" TEXT NOT NULL DEFAULT 'secondary';
ALTER TABLE "hunt"."Observation" ADD COLUMN "verificationStatus" TEXT NOT NULL DEFAULT 'unverified';
ALTER TABLE "hunt"."Observation" ADD COLUMN "entityConfidence" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "hunt"."Observation" ADD COLUMN "evidenceConfidence" INTEGER NOT NULL DEFAULT 50;

ALTER TABLE "hunt"."SignalCluster" ADD COLUMN "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "hunt"."SignalCluster" ADD COLUMN "windowEnd" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "hunt"."OpportunityCandidate" ADD COLUMN "investigationNotes" TEXT;
ALTER TABLE "hunt"."OpportunityCandidate" ADD COLUMN "investigatedAt" TIMESTAMP(3);

ALTER TABLE "hunt"."UserWatch" ADD COLUMN "signalTypes" JSONB;
ALTER TABLE "hunt"."UserWatch" ADD COLUMN "minScore" INTEGER NOT NULL DEFAULT 20;
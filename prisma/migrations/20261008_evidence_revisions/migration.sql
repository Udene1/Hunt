CREATE TABLE IF NOT EXISTS "hunt"."ObservationRevision" (
  "id" TEXT NOT NULL,
  "observationId" TEXT NOT NULL,
  "runId" TEXT,
  "source" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "url" TEXT,
  "fingerprint" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  "sourceTier" TEXT NOT NULL DEFAULT 'secondary',
  "verificationStatus" TEXT NOT NULL DEFAULT 'unverified',
  "entityConfidence" INTEGER NOT NULL DEFAULT 50,
  "evidenceConfidence" INTEGER NOT NULL DEFAULT 50,
  CONSTRAINT "ObservationRevision_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ObservationRevision_observationId_capturedAt_idx" ON "hunt"."ObservationRevision"("observationId","capturedAt");
CREATE INDEX IF NOT EXISTS "ObservationRevision_runId_idx" ON "hunt"."ObservationRevision"("runId");
DO $$ BEGIN
  ALTER TABLE "hunt"."ObservationRevision" ADD CONSTRAINT "ObservationRevision_observationId_fkey"
  FOREIGN KEY ("observationId") REFERENCES "hunt"."Observation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "hunt"."ObservationRevision" ADD CONSTRAINT "ObservationRevision_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "hunt"."MonitoringRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
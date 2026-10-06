-- Hunt initial production baseline.
-- The existing Neon database already contains this schema. This migration is
-- recorded as applied in that database and exists so fresh databases have a
-- complete reproducible starting point.

CREATE SCHEMA IF NOT EXISTS "hunt";

CREATE TABLE "hunt"."Company" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "normalized" TEXT NOT NULL,
  "domain" TEXT,
  "country" TEXT NOT NULL DEFAULT 'NG',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "generalSummary" TEXT,
  "summaryUpdatedAt" TIMESTAMP(3),
  "summaryEvidenceAt" TIMESTAMP(3),
  "summaryVersion" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Company_name_key" ON "hunt"."Company"("name");
CREATE UNIQUE INDEX "Company_normalized_key" ON "hunt"."Company"("normalized");

CREATE TABLE "hunt"."Watch" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Watch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Watch_companyId_key" ON "hunt"."Watch"("companyId");

CREATE TABLE "hunt"."MonitoringRun" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'running',
  "observationCount" INTEGER NOT NULL DEFAULT 0,
  "errorCount" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "MonitoringRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "hunt"."Observation" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "runId" TEXT,
  "source" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "url" TEXT,
  "fingerprint" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  "status" TEXT NOT NULL DEFAULT 'active',
  "missCount" INTEGER NOT NULL DEFAULT 0,
  "lastProbeAt" TIMESTAMP(3),
  "missingSince" TIMESTAMP(3),
  "confirmedRemovedAt" TIMESTAMP(3),
  CONSTRAINT "Observation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Observation_companyId_fingerprint_key" ON "hunt"."Observation"("companyId","fingerprint");
CREATE INDEX "Observation_companyId_observedAt_idx" ON "hunt"."Observation"("companyId","observedAt");

CREATE TABLE "hunt"."Signal" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "runId" TEXT,
  "score" INTEGER NOT NULL,
  "headline" TEXT NOT NULL,
  "detail" TEXT NOT NULL,
  "commercialInterpretation" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Signal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Signal_companyId_createdAt_idx" ON "hunt"."Signal"("companyId","createdAt");

CREATE TABLE "hunt"."User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "plan" TEXT NOT NULL DEFAULT 'free',
  "pilotExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "hunt"."User"("email");

CREATE TABLE "hunt"."UserProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "profession" TEXT,
  "services" JSONB,
  "industries" JSONB,
  "geography" TEXT,
  "idealCustomer" TEXT,
  "targetCompanies" JSONB,
  "desiredSignals" JSONB,
  "exclusions" JSONB,
  "commercialObjectives" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserProfile_userId_key" ON "hunt"."UserProfile"("userId");

CREATE TABLE "hunt"."Session" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "hunt"."Session"("tokenHash");
CREATE INDEX "Session_userId_idx" ON "hunt"."Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "hunt"."Session"("expiresAt");

CREATE TABLE "hunt"."UserWatch" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserWatch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UserWatch_userId_companyId_key" ON "hunt"."UserWatch"("userId","companyId");
CREATE INDEX "UserWatch_userId_createdAt_idx" ON "hunt"."UserWatch"("userId","createdAt");

CREATE TABLE "hunt"."PilotCode" (
  "id" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "durationDays" INTEGER NOT NULL DEFAULT 14,
  "redeemedAt" TIMESTAMP(3),
  "redeemedByUserId" TEXT,
  CONSTRAINT "PilotCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PilotCode_codeHash_key" ON "hunt"."PilotCode"("codeHash");
CREATE INDEX "PilotCode_expiresAt_idx" ON "hunt"."PilotCode"("expiresAt");

CREATE TABLE "hunt"."AccessToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "label" TEXT NOT NULL DEFAULT 'MCP',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "AccessToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AccessToken_tokenHash_key" ON "hunt"."AccessToken"("tokenHash");
CREATE INDEX "AccessToken_userId_revokedAt_idx" ON "hunt"."AccessToken"("userId","revokedAt");

CREATE TABLE "hunt"."AdminAccessToken" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "label" TEXT NOT NULL DEFAULT 'Admin AI',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "AdminAccessToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdminAccessToken_tokenHash_key" ON "hunt"."AdminAccessToken"("tokenHash");
CREATE INDEX "AdminAccessToken_revokedAt_idx" ON "hunt"."AdminAccessToken"("revokedAt");

ALTER TABLE "hunt"."Watch"
  ADD CONSTRAINT "Watch_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "hunt"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hunt"."MonitoringRun"
  ADD CONSTRAINT "MonitoringRun_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "hunt"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hunt"."Observation"
  ADD CONSTRAINT "Observation_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "hunt"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hunt"."Observation"
  ADD CONSTRAINT "Observation_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "hunt"."MonitoringRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "hunt"."Signal"
  ADD CONSTRAINT "Signal_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "hunt"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hunt"."Signal"
  ADD CONSTRAINT "Signal_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "hunt"."MonitoringRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "hunt"."UserProfile"
  ADD CONSTRAINT "UserProfile_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "hunt"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hunt"."Session"
  ADD CONSTRAINT "Session_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "hunt"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hunt"."UserWatch"
  ADD CONSTRAINT "UserWatch_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "hunt"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "hunt"."UserWatch"
  ADD CONSTRAINT "UserWatch_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "hunt"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hunt"."PilotCode"
  ADD CONSTRAINT "PilotCode_redeemedByUserId_fkey"
  FOREIGN KEY ("redeemedByUserId") REFERENCES "hunt"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "hunt"."AccessToken"
  ADD CONSTRAINT "AccessToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "hunt"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

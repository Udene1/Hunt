-- Hunt production schema additions.
-- This database was originally initialized with prisma db push, so this migration
-- is deliberately idempotent for objects that may already exist.

ALTER TABLE "hunt"."Company"
  ADD COLUMN IF NOT EXISTS "generalSummary" TEXT,
  ADD COLUMN IF NOT EXISTS "summaryUpdatedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "summaryEvidenceAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "summaryVersion" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "hunt"."UserWatch" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserWatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserWatch_userId_companyId_key"
  ON "hunt"."UserWatch"("userId","companyId");
CREATE INDEX IF NOT EXISTS "UserWatch_userId_createdAt_idx"
  ON "hunt"."UserWatch"("userId","createdAt");

DO $$ BEGIN
  ALTER TABLE "hunt"."UserWatch"
    ADD CONSTRAINT "UserWatch_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "hunt"."User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "hunt"."UserWatch"
    ADD CONSTRAINT "UserWatch_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "hunt"."Company"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "hunt"."AccessToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "label" TEXT NOT NULL DEFAULT 'MCP',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "AccessToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AccessToken_tokenHash_key"
  ON "hunt"."AccessToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "AccessToken_userId_revokedAt_idx"
  ON "hunt"."AccessToken"("userId","revokedAt");

DO $$ BEGIN
  ALTER TABLE "hunt"."AccessToken"
    ADD CONSTRAINT "AccessToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "hunt"."User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "hunt"."AdminAccessToken" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "label" TEXT NOT NULL DEFAULT 'Admin AI',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "AdminAccessToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AdminAccessToken_tokenHash_key"
  ON "hunt"."AdminAccessToken"("tokenHash");
CREATE INDEX IF NOT EXISTS "AdminAccessToken_revokedAt_idx"
  ON "hunt"."AdminAccessToken"("revokedAt");

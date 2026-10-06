-- Durable company contacts and financial context.
CREATE TABLE IF NOT EXISTS "hunt"."CompanyContact" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT '',
  "email" TEXT,
  "phone" TEXT,
  "linkedinUrl" TEXT,
  "source" TEXT NOT NULL,
  "sourceUrl" TEXT,
  "evidenceId" TEXT,
  "confidence" INTEGER NOT NULL DEFAULT 50,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompanyContact_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CompanyContact_companyId_name_role_key" ON "hunt"."CompanyContact"("companyId","name","role");
CREATE INDEX IF NOT EXISTS "CompanyContact_companyId_lastSeenAt_idx" ON "hunt"."CompanyContact"("companyId","lastSeenAt");
CREATE INDEX IF NOT EXISTS "CompanyContact_companyId_role_idx" ON "hunt"."CompanyContact"("companyId","role");
DO $$ BEGIN ALTER TABLE "hunt"."CompanyContact" ADD CONSTRAINT "CompanyContact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "hunt"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "hunt"."FinancialRecord" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "period" TEXT NOT NULL,
  "statementType" TEXT NOT NULL,
  "currency" TEXT,
  "source" TEXT NOT NULL,
  "sourceUrl" TEXT,
  "publishedAt" TIMESTAMP(3),
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "summary" TEXT,
  "metrics" JSONB,
  "evidenceId" TEXT,
  "confidence" INTEGER NOT NULL DEFAULT 50,
  CONSTRAINT "FinancialRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "FinancialRecord_companyId_period_statementType_source_key" ON "hunt"."FinancialRecord"("companyId","period","statementType","source");
CREATE INDEX IF NOT EXISTS "FinancialRecord_companyId_publishedAt_idx" ON "hunt"."FinancialRecord"("companyId","publishedAt");
CREATE INDEX IF NOT EXISTS "FinancialRecord_companyId_observedAt_idx" ON "hunt"."FinancialRecord"("companyId","observedAt");
DO $$ BEGIN ALTER TABLE "hunt"."FinancialRecord" ADD CONSTRAINT "FinancialRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "hunt"."Company"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

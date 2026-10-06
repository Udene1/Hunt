ALTER TABLE "hunt"."CompanyContact" ADD COLUMN "verificationStatus" TEXT NOT NULL DEFAULT 'verified';
ALTER TABLE "hunt"."FinancialRecord" ADD COLUMN "verificationStatus" TEXT NOT NULL DEFAULT 'verified';

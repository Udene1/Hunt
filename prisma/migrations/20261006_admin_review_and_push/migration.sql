CREATE TABLE "hunt"."AdminReviewTask" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "type" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'high',
  "title" TEXT NOT NULL,
  "detail" TEXT NOT NULL,
  "sourceUrl" TEXT,
  "fingerprint" TEXT NOT NULL,
  "metadata" JSONB,
  "status" TEXT NOT NULL DEFAULT 'open',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "resolvedBy" TEXT,
  CONSTRAINT "AdminReviewTask_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdminReviewTask_fingerprint_key" ON "hunt"."AdminReviewTask"("fingerprint");
CREATE INDEX "AdminReviewTask_status_createdAt_idx" ON "hunt"."AdminReviewTask"("status","createdAt");
CREATE INDEX "AdminReviewTask_companyId_status_idx" ON "hunt"."AdminReviewTask"("companyId","status");
ALTER TABLE "hunt"."AdminReviewTask" ADD CONSTRAINT "AdminReviewTask_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "hunt"."Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "hunt"."AdminPushSubscription" (
  "id" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  CONSTRAINT "AdminPushSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdminPushSubscription_endpoint_key" ON "hunt"."AdminPushSubscription"("endpoint");
CREATE INDEX "AdminPushSubscription_lastUsedAt_idx" ON "hunt"."AdminPushSubscription"("lastUsedAt");
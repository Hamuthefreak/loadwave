-- Verified authority + subscription entitlements.
--
-- 1. FMCSA check columns. The public FMCSA lookup returns operating status but
--    not a reliable authority grant date, so authority AGE stays self-declared
--    (Tenant.authoritySince) while operating status becomes genuinely checked.
--    fmcsaCheckedAt is the flag that separates "checked" from "typed in", which
--    is the difference the Verified badge previously claimed without earning.
-- 2. Subscription columns. plan defaults to TRIAL; trialEndsAt drives the trial
--    clock, after which entitlements fall back to the free Solo feature set.
--
-- Existing tenants are backfilled with a fresh 30-day trial rather than being
-- dropped straight onto the free tier, so nobody loses tools they were already
-- using the moment this ships.

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "fmcsaDotNumber" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "fmcsaStatus" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "fmcsaLegalName" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "fmcsaCheckedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "plan" TEXT NOT NULL DEFAULT 'TRIAL';
ALTER TABLE "Tenant" ADD COLUMN "trialEndsAt" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "planChangedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PlanRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestedPlan" TEXT NOT NULL,
    "requestedById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "PlanRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanRequest_tenantId_status_idx" ON "PlanRequest"("tenantId", "status");

-- CreateIndex
CREATE INDEX "PlanRequest_status_createdAt_idx" ON "PlanRequest"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "PlanRequest" ADD CONSTRAINT "PlanRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: everyone already on the platform keeps the full product for 30 days.
UPDATE "Tenant" SET "trialEndsAt" = now() + interval '30 days' WHERE "trialEndsAt" IS NULL;

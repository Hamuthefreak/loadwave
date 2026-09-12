-- Trust layer: what a counterparty sees before committing to freight.
--
-- 1. Tenant compliance: declared authority date/status and insurance on file
--    with an expiry. Other boards sell external verification here; we show
--    self-declared facts as self-declared, plus the authority's age.
-- 2. Invoice.payerTenantId: when a tenant invoices a marketplace load it
--    booked, the load's owner is the payer. That link is what makes a real
--    "pays in ~N days" record possible instead of a bought credit score.
-- 3. TenantReport: a counterparty complaint, only from a tenant with a real
--    trading relation, surfaced publicly as an aggregate count.
--
-- Applied to dev via `db push`; this file brings production in line during
-- `prisma migrate deploy`.

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "authoritySince" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "authorityStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED';
ALTER TABLE "Tenant" ADD COLUMN "insuranceCarrier" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "insurancePolicyNumber" TEXT;
ALTER TABLE "Tenant" ADD COLUMN "cargoInsuranceLimit" DECIMAL(14,2);
ALTER TABLE "Tenant" ADD COLUMN "insuranceExpiresAt" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "complianceUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "payerTenantId" TEXT;

-- CreateIndex
CREATE INDEX "Invoice_payerTenantId_paidAt_idx" ON "Invoice"("payerTenantId", "paidAt");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_payerTenantId_fkey" FOREIGN KEY ("payerTenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "TenantReport" (
    "id" TEXT NOT NULL,
    "reporterTenantId" TEXT NOT NULL,
    "subjectTenantId" TEXT NOT NULL,
    "loadId" TEXT,
    "category" TEXT NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TenantReport_subjectTenantId_createdAt_idx" ON "TenantReport"("subjectTenantId", "createdAt");

-- CreateIndex
CREATE INDEX "TenantReport_reporterTenantId_createdAt_idx" ON "TenantReport"("reporterTenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "TenantReport" ADD CONSTRAINT "TenantReport_reporterTenantId_fkey" FOREIGN KEY ("reporterTenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantReport" ADD CONSTRAINT "TenantReport_subjectTenantId_fkey" FOREIGN KEY ("subjectTenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantReport" ADD CONSTRAINT "TenantReport_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "paidAmountBase" DECIMAL(18,6),
ADD COLUMN     "paidAmountTransaction" DECIMAL(18,6),
ADD COLUMN     "paidAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Invoice_tenantId_paidAt_idx" ON "Invoice"("tenantId", "paidAt");

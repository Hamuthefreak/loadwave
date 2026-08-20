-- AlterTable
ALTER TABLE "Load" ADD COLUMN     "deliveryDate" TIMESTAMP(3),
ADD COLUMN     "equipmentType" TEXT,
ADD COLUMN     "pickupDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "mcNumber" TEXT,
ADD COLUMN     "usdotNumber" TEXT;

-- CreateTable
CREATE TABLE "TruckPost" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "equipmentType" TEXT NOT NULL,
    "trailerType" TEXT,
    "locationCountry" TEXT NOT NULL,
    "locationRegion" TEXT NOT NULL,
    "availableFrom" TIMESTAMP(3) NOT NULL,
    "availableTo" TIMESTAMP(3),
    "rateCurrency" TEXT NOT NULL DEFAULT 'CAD',
    "rateAmount" DECIMAL(18,6),
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "bookedByTenantId" TEXT,
    "bookedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TruckPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TruckPost_tenantId_status_idx" ON "TruckPost"("tenantId", "status");

-- CreateIndex
CREATE INDEX "TruckPost_status_locationRegion_equipmentType_idx" ON "TruckPost"("status", "locationRegion", "equipmentType");

-- AddForeignKey
ALTER TABLE "TruckPost" ADD CONSTRAINT "TruckPost_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TruckPost" ADD CONSTRAINT "TruckPost_bookedByTenantId_fkey" FOREIGN KEY ("bookedByTenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

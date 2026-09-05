-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "ratingCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ratingAvg" DECIMAL(3,2);

-- CreateTable
CREATE TABLE "CarrierRating" (
    "id" TEXT NOT NULL,
    "loadId" TEXT NOT NULL,
    "ratedTenantId" TEXT NOT NULL,
    "raterTenantId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarrierRating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CarrierRating_loadId_raterTenantId_key" ON "CarrierRating"("loadId", "raterTenantId");

-- CreateIndex
CREATE INDEX "CarrierRating_ratedTenantId_idx" ON "CarrierRating"("ratedTenantId");

-- AddForeignKey
ALTER TABLE "CarrierRating" ADD CONSTRAINT "CarrierRating_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarrierRating" ADD CONSTRAINT "CarrierRating_ratedTenantId_fkey" FOREIGN KEY ("ratedTenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarrierRating" ADD CONSTRAINT "CarrierRating_raterTenantId_fkey" FOREIGN KEY ("raterTenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

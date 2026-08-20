-- AlterTable
ALTER TABLE "Load" ADD COLUMN     "accessorials" JSONB,
ADD COLUMN     "assignedAt" TIMESTAMP(3),
ADD COLUMN     "assigneeAssetId" TEXT,
ADD COLUMN     "assigneeDriverId" TEXT,
ADD COLUMN     "commodity" TEXT,
ADD COLUMN     "destinationLat" DOUBLE PRECISION,
ADD COLUMN     "destinationLocality" TEXT,
ADD COLUMN     "destinationLon" DOUBLE PRECISION,
ADD COLUMN     "detentionRate" DECIMAL(10,2),
ADD COLUMN     "hazmat" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "originLat" DOUBLE PRECISION,
ADD COLUMN     "originLocality" TEXT,
ADD COLUMN     "originLon" DOUBLE PRECISION,
ADD COLUMN     "pickupFlexible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stopCount" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "teamRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "temperatureMax" INTEGER,
ADD COLUMN     "temperatureMin" INTEGER,
ADD COLUMN     "weightKg" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "TruckPost" ADD COLUMN     "locationLat" DOUBLE PRECISION,
ADD COLUMN     "locationLocality" TEXT,
ADD COLUMN     "locationLon" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "LoadStop" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loadId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ORIGIN',
    "stopOrder" INTEGER NOT NULL DEFAULT 1,
    "country" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "locality" TEXT,
    "lat" DOUBLE PRECISION,
    "lon" DOUBLE PRECISION,
    "scheduledAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoadStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostalPlace" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "placeName" TEXT NOT NULL,
    "postalPrefix" TEXT NOT NULL DEFAULT '',
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "population" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostalPlace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedSearch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "filtersJson" TEXT NOT NULL,
    "notify" BOOLEAN NOT NULL DEFAULT false,
    "lastCheckAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'system',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "payload" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantSetting" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "valueJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaneDailyStat" (
    "id" TEXT NOT NULL,
    "statDate" DATE NOT NULL,
    "originRegion" TEXT NOT NULL,
    "destinationRegion" TEXT NOT NULL,
    "equipmentType" TEXT NOT NULL DEFAULT 'ALL',
    "loadsSeen" INTEGER NOT NULL DEFAULT 0,
    "trucksSeen" INTEGER NOT NULL DEFAULT 0,
    "avgRate" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LaneDailyStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoadStop_loadId_idx" ON "LoadStop"("loadId");

-- CreateIndex
CREATE INDEX "LoadStop_tenantId_idx" ON "LoadStop"("tenantId");

-- CreateIndex
CREATE INDEX "PostalPlace_country_region_idx" ON "PostalPlace"("country", "region");

-- CreateIndex
CREATE INDEX "PostalPlace_placeName_idx" ON "PostalPlace"("placeName");

-- CreateIndex
CREATE UNIQUE INDEX "PostalPlace_country_region_placeName_postalPrefix_key" ON "PostalPlace"("country", "region", "placeName", "postalPrefix");

-- CreateIndex
CREATE INDEX "SavedSearch_tenantId_idx" ON "SavedSearch"("tenantId");

-- CreateIndex
CREATE INDEX "Notification_tenantId_createdAt_idx" ON "Notification"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_tenantId_readAt_idx" ON "Notification"("tenantId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "TenantSetting_tenantId_key_key" ON "TenantSetting"("tenantId", "key");

-- CreateIndex
CREATE INDEX "LaneDailyStat_statDate_idx" ON "LaneDailyStat"("statDate");

-- CreateIndex
CREATE UNIQUE INDEX "LaneDailyStat_statDate_originRegion_destinationRegion_equip_key" ON "LaneDailyStat"("statDate", "originRegion", "destinationRegion", "equipmentType");

-- CreateIndex
CREATE UNIQUE INDEX "Load_tenantId_externalLoadboardId_key" ON "Load"("tenantId", "externalLoadboardId");

-- AddForeignKey
ALTER TABLE "Load" ADD CONSTRAINT "Load_assigneeDriverId_fkey" FOREIGN KEY ("assigneeDriverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Load" ADD CONSTRAINT "Load_assigneeAssetId_fkey" FOREIGN KEY ("assigneeAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoadStop" ADD CONSTRAINT "LoadStop_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedSearch" ADD CONSTRAINT "SavedSearch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantSetting" ADD CONSTRAINT "TenantSetting_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

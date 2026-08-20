-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'DISPATCHER', 'DRIVER');

-- CreateEnum
CREATE TYPE "CycleType" AS ENUM ('CYCLE_1', 'CYCLE_2');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('TRACTOR', 'TRAILER');

-- CreateEnum
CREATE TYPE "DutyStatus" AS ENUM ('OFF_DUTY', 'SLEEPER_BERTH', 'DRIVING', 'ON_DUTY_NOT_DRIVING');

-- CreateEnum
CREATE TYPE "TaxExemptReason" AS ENUM ('INTERNATIONAL_OUTBOUND', 'CONTINUOUS_INBOUND', 'INTERLINING', 'OTHER');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL DEFAULT 'CAD',
    "baseJurisdiction" TEXT NOT NULL DEFAULT 'QC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "roles" TEXT NOT NULL DEFAULT 'DISPATCHER',
    "driverId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalEldId" TEXT,
    "name" TEXT NOT NULL,
    "licenseNumber" TEXT,
    "homeTerminalTz" TEXT NOT NULL DEFAULT 'America/Toronto',
    "cycleType" "CycleType" NOT NULL DEFAULT 'CYCLE_1',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vin" TEXT,
    "powerUnitNumber" TEXT,
    "assetType" "AssetType" NOT NULL DEFAULT 'TRACTOR',
    "eldDeviceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HosLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "assetId" TEXT,
    "dutyStatus" "DutyStatus" NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "engineHoursStart" DECIMAL(65,30),
    "engineHoursEnd" DECIMAL(65,30),
    "vehicleDistanceStart" DECIMAL(65,30),
    "vehicleDistanceEnd" DECIMAL(65,30),
    "sourceEventId" TEXT,
    "ingestSource" TEXT NOT NULL DEFAULT 'WEBHOOK',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HosLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutePoint" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "engineHours" DECIMAL(65,30),
    "vehicleDistanceKm" DECIMAL(65,30),
    "speed" DECIMAL(65,30),
    "eldEventType" TEXT,
    "sourceEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoutePoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteSegment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "driverId" TEXT,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "distanceKm" DECIMAL(12,4) NOT NULL,
    "jurisdictionCode" TEXT,
    "fuelType" TEXT,
    "geomText" TEXT,
    "quarter" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RouteSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FuelTransaction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "assetId" TEXT,
    "driverId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "jurisdictionCode" TEXT NOT NULL,
    "locationLat" DOUBLE PRECISION,
    "locationLon" DOUBLE PRECISION,
    "volumeLitres" DECIMAL(14,4) NOT NULL,
    "originalVolume" DECIMAL(14,4),
    "originalVolumeUnit" TEXT,
    "transactionCurrency" TEXT NOT NULL,
    "amountTransaction" DECIMAL(18,6) NOT NULL,
    "exchangeRateToBase" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "amountBase" DECIMAL(18,6) NOT NULL,
    "taxGstRate" DECIMAL(6,4),
    "taxHstRate" DECIMAL(6,4),
    "taxQstRate" DECIMAL(6,4),
    "taxGstAmount" DECIMAL(14,6),
    "taxHstAmount" DECIMAL(14,6),
    "taxQstAmount" DECIMAL(14,6),
    "fuelType" TEXT DEFAULT 'DSL',
    "sourceEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FuelTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FxRate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fromCurrency" TEXT NOT NULL,
    "toCurrency" TEXT NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "quarter" TEXT,
    "rateDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Load" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "externalLoadboardId" TEXT,
    "originCountry" TEXT NOT NULL,
    "originRegion" TEXT NOT NULL,
    "destinationCountry" TEXT NOT NULL,
    "destinationRegion" TEXT NOT NULL,
    "distanceKmEstimate" DECIMAL(12,4),
    "freightCurrency" TEXT NOT NULL DEFAULT 'CAD',
    "freightAmountTransaction" DECIMAL(18,6),
    "freightAmountBase" DECIMAL(18,6),
    "exchangeRateToBase" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "isInternational" BOOLEAN NOT NULL DEFAULT false,
    "isContinuousInboundOutbound" BOOLEAN NOT NULL DEFAULT false,
    "interliningPartner" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "marketplaceStatus" TEXT NOT NULL DEFAULT 'PRIVATE',
    "bookedByTenantId" TEXT,
    "bookedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Load_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "loadId" TEXT,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "currencyTransaction" TEXT NOT NULL DEFAULT 'CAD',
    "subtotalTransaction" DECIMAL(18,6) NOT NULL,
    "subtotalBase" DECIMAL(18,6) NOT NULL,
    "exchangeRateToBase" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "gstRate" DECIMAL(6,4),
    "hstRate" DECIMAL(6,4),
    "qstRate" DECIMAL(6,4),
    "gstAmountTransaction" DECIMAL(14,6),
    "hstAmountTransaction" DECIMAL(14,6),
    "qstAmountTransaction" DECIMAL(14,6),
    "totalTransaction" DECIMAL(18,6) NOT NULL,
    "totalBase" DECIMAL(18,6) NOT NULL,
    "zeroRated" BOOLEAN NOT NULL DEFAULT false,
    "taxExemptReason" "TaxExemptReason",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IftaQuarterSummary" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "quarter" TEXT NOT NULL,
    "assetId" TEXT,
    "fuelType" TEXT NOT NULL DEFAULT 'DSL',
    "jurisdictionCode" TEXT NOT NULL,
    "totalKm" DECIMAL(14,4) NOT NULL,
    "taxableKm" DECIMAL(14,4) NOT NULL,
    "litresPurchased" DECIMAL(14,4) NOT NULL,
    "litresConsumed" DECIMAL(14,6) NOT NULL,
    "averageConsumption" DECIMAL(12,8) NOT NULL,
    "netLitres" DECIMAL(14,4) NOT NULL,
    "jurisdictionRate" DECIMAL(10,4) NOT NULL,
    "netTaxDueBase" DECIMAL(16,6) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IftaQuarterSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "Driver_tenantId_idx" ON "Driver"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_tenantId_externalEldId_key" ON "Driver"("tenantId", "externalEldId");

-- CreateIndex
CREATE INDEX "Asset_tenantId_idx" ON "Asset"("tenantId");

-- CreateIndex
CREATE INDEX "HosLog_tenantId_driverId_startTime_idx" ON "HosLog"("tenantId", "driverId", "startTime");

-- CreateIndex
CREATE UNIQUE INDEX "HosLog_tenantId_sourceEventId_key" ON "HosLog"("tenantId", "sourceEventId");

-- CreateIndex
CREATE INDEX "RoutePoint_tenantId_assetId_occurredAt_idx" ON "RoutePoint"("tenantId", "assetId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "RoutePoint_tenantId_sourceEventId_key" ON "RoutePoint"("tenantId", "sourceEventId");

-- CreateIndex
CREATE INDEX "RouteSegment_tenantId_assetId_startTime_idx" ON "RouteSegment"("tenantId", "assetId", "startTime");

-- CreateIndex
CREATE INDEX "RouteSegment_tenantId_quarter_jurisdictionCode_idx" ON "RouteSegment"("tenantId", "quarter", "jurisdictionCode");

-- CreateIndex
CREATE INDEX "FuelTransaction_tenantId_occurredAt_jurisdictionCode_idx" ON "FuelTransaction"("tenantId", "occurredAt", "jurisdictionCode");

-- CreateIndex
CREATE UNIQUE INDEX "FuelTransaction_tenantId_sourceEventId_key" ON "FuelTransaction"("tenantId", "sourceEventId");

-- CreateIndex
CREATE INDEX "FxRate_tenantId_fromCurrency_toCurrency_quarter_idx" ON "FxRate"("tenantId", "fromCurrency", "toCurrency", "quarter");

-- CreateIndex
CREATE UNIQUE INDEX "FxRate_tenantId_fromCurrency_toCurrency_quarter_rateDate_key" ON "FxRate"("tenantId", "fromCurrency", "toCurrency", "quarter", "rateDate");

-- CreateIndex
CREATE INDEX "Load_tenantId_status_idx" ON "Load"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Load_marketplaceStatus_originRegion_destinationRegion_idx" ON "Load"("marketplaceStatus", "originRegion", "destinationRegion");

-- CreateIndex
CREATE INDEX "Load_marketplaceStatus_bookedAt_idx" ON "Load"("marketplaceStatus", "bookedAt");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_issueDate_idx" ON "Invoice"("tenantId", "issueDate");

-- CreateIndex
CREATE INDEX "IftaQuarterSummary_tenantId_quarter_status_idx" ON "IftaQuarterSummary"("tenantId", "quarter", "status");

-- CreateIndex
CREATE UNIQUE INDEX "IftaQuarterSummary_tenantId_quarter_assetId_fuelType_jurisd_key" ON "IftaQuarterSummary"("tenantId", "quarter", "assetId", "fuelType", "jurisdictionCode");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HosLog" ADD CONSTRAINT "HosLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HosLog" ADD CONSTRAINT "HosLog_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HosLog" ADD CONSTRAINT "HosLog_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutePoint" ADD CONSTRAINT "RoutePoint_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutePoint" ADD CONSTRAINT "RoutePoint_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutePoint" ADD CONSTRAINT "RoutePoint_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteSegment" ADD CONSTRAINT "RouteSegment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteSegment" ADD CONSTRAINT "RouteSegment_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelTransaction" ADD CONSTRAINT "FuelTransaction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelTransaction" ADD CONSTRAINT "FuelTransaction_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelTransaction" ADD CONSTRAINT "FuelTransaction_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FxRate" ADD CONSTRAINT "FxRate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Load" ADD CONSTRAINT "Load_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Load" ADD CONSTRAINT "Load_bookedByTenantId_fkey" FOREIGN KEY ("bookedByTenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IftaQuarterSummary" ADD CONSTRAINT "IftaQuarterSummary_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

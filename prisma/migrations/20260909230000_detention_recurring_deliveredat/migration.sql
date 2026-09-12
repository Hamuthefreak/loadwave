-- Detention & layover entries, recurring-load scheduling, and real
-- delivered-at timestamps (driver scorecards). Applied to dev via
-- `prisma db push` before the migration existed; this file brings
-- production in line during `prisma migrate deploy`.

-- AlterTable
ALTER TABLE "Load" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "nextRecurrenceAt" TIMESTAMP(3),
ADD COLUMN     "recurringDays" TEXT;

-- CreateTable
CREATE TABLE "DetentionEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loadId" TEXT NOT NULL,
    "driverId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "ratePerHour" DECIMAL(10,2),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DetentionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DetentionEntry_tenantId_loadId_idx" ON "DetentionEntry"("tenantId", "loadId");

-- CreateIndex
CREATE INDEX "DetentionEntry_loadId_endedAt_idx" ON "DetentionEntry"("loadId", "endedAt");

-- AddForeignKey
ALTER TABLE "DetentionEntry" ADD CONSTRAINT "DetentionEntry_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetentionEntry" ADD CONSTRAINT "DetentionEntry_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

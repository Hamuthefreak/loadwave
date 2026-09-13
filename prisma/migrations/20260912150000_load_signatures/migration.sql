-- Captured signatures (receiver at the dock, driver acceptance, broker
-- acceptance). Held as the drawn image so the delivery packet can embed it
-- without re-rendering anything.
CREATE TABLE "LoadSignature" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "loadId" TEXT NOT NULL,
    "driverId" TEXT,
    "role" TEXT NOT NULL DEFAULT 'RECEIVER',
    "signerName" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mimeType" TEXT NOT NULL DEFAULT 'image/jpeg',
    "sizeBytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "capturedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoadSignature_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LoadSignature_tenantId_loadId_signedAt_idx" ON "LoadSignature"("tenantId", "loadId", "signedAt");

ALTER TABLE "LoadSignature" ADD CONSTRAINT "LoadSignature_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoadSignature" ADD CONSTRAINT "LoadSignature_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoadSignature" ADD CONSTRAINT "LoadSignature_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

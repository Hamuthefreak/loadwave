-- Driver pay queries, settlement sign-off, and recorded compliance overrides.
--
-- Three tables, one theme: the facts that have to survive after the moment they
-- happened. A dispute points at the numbers the driver was looking at (statements
-- re-price on read, so the line is snapshotted). A signature is appended rather
-- than overwritten, so a re-sign leaves the trail. An override names who ran a
-- truck on a lapsed document and why.

CREATE TABLE "PayDispute" (
    "id"          TEXT NOT NULL,
    "tenantId"    TEXT NOT NULL,
    "driverId"    TEXT NOT NULL,
    "loadId"      TEXT,
    "subject"     TEXT NOT NULL DEFAULT 'LINE',
    "status"      TEXT NOT NULL DEFAULT 'OPEN',
    "message"     TEXT NOT NULL,
    "periodLabel" TEXT NOT NULL,
    "periodFrom"  TIMESTAMP(3) NOT NULL,
    "periodTo"    TIMESTAMP(3) NOT NULL,
    "line"        JSONB NOT NULL,
    "resolution"  TEXT,
    "decidedById" TEXT,
    "decidedAt"   TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayDispute_pkey" PRIMARY KEY ("id")
);

-- The office inbox reads open queries newest-first.
CREATE INDEX "PayDispute_tenantId_status_createdAt_idx" ON "PayDispute"("tenantId", "status", "createdAt");

-- The driver's own history.
CREATE INDEX "PayDispute_tenantId_driverId_createdAt_idx" ON "PayDispute"("tenantId", "driverId", "createdAt");

ALTER TABLE "PayDispute" ADD CONSTRAINT "PayDispute_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayDispute" ADD CONSTRAINT "PayDispute_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- SetNull rather than Cascade: deleting the load must not delete the record that
-- somebody questioned how it was paid.
ALTER TABLE "PayDispute" ADD CONSTRAINT "PayDispute_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "SettlementSignature" (
    "id"           TEXT NOT NULL,
    "tenantId"     TEXT NOT NULL,
    "driverId"     TEXT NOT NULL,
    "periodFrom"   TIMESTAMP(3) NOT NULL,
    "periodTo"     TIMESTAMP(3) NOT NULL,
    "periodLabel"  TEXT NOT NULL,
    "role"         TEXT NOT NULL DEFAULT 'DRIVER',
    "signerName"   TEXT NOT NULL,
    "signedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mimeType"     TEXT NOT NULL DEFAULT 'image/jpeg',
    "sizeBytes"    INTEGER NOT NULL,
    "data"         BYTEA NOT NULL,
    "capturedById" TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementSignature_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SettlementSignature_tenantId_driverId_periodFrom_idx" ON "SettlementSignature"("tenantId", "driverId", "periodFrom");

ALTER TABLE "SettlementSignature" ADD CONSTRAINT "SettlementSignature_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SettlementSignature" ADD CONSTRAINT "SettlementSignature_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ComplianceOverride" (
    "id"        TEXT NOT NULL,
    "tenantId"  TEXT NOT NULL,
    "loadId"    TEXT NOT NULL,
    "driverId"  TEXT,
    "assetId"   TEXT,
    "blockers"  JSONB NOT NULL,
    "reason"    TEXT NOT NULL,
    "actorId"   TEXT,
    "actorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceOverride_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ComplianceOverride_tenantId_createdAt_idx" ON "ComplianceOverride"("tenantId", "createdAt");
CREATE INDEX "ComplianceOverride_loadId_idx" ON "ComplianceOverride"("loadId");

ALTER TABLE "ComplianceOverride" ADD CONSTRAINT "ComplianceOverride_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ComplianceOverride" ADD CONSTRAINT "ComplianceOverride_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE CASCADE ON UPDATE CASCADE;

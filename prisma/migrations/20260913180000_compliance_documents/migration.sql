-- Compliance documents: the driver qualification file (49 CFR 391.51) plus the
-- carrier and equipment paperwork a roadside inspection asks for. One row per
-- (subject, kind), so the table is the "what is on file right now" answer and
-- the unique key is the upsert target.
CREATE TYPE "ComplianceSubject" AS ENUM ('DRIVER', 'ASSET', 'TENANT');

CREATE TABLE "ComplianceDocument" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subject" "ComplianceSubject" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "identifier" TEXT,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "notes" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "data" BYTEA,
    "uploadedById" TEXT,
    "notifiedStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceDocument_pkey" PRIMARY KEY ("id")
);

-- The upsert target: one document per kind per driver/asset/carrier.
CREATE UNIQUE INDEX "ComplianceDocument_tenantId_subject_subjectId_kind_key" ON "ComplianceDocument"("tenantId", "subject", "subjectId", "kind");

CREATE INDEX "ComplianceDocument_tenantId_subject_subjectId_idx" ON "ComplianceDocument"("tenantId", "subject", "subjectId");

-- The expiry sweep scans everything lapsing soon, across every tenant.
CREATE INDEX "ComplianceDocument_expiresAt_idx" ON "ComplianceDocument"("expiresAt");

ALTER TABLE "ComplianceDocument" ADD CONSTRAINT "ComplianceDocument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

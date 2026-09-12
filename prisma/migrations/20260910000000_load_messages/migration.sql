-- In-app rate negotiation thread (LoadMessage) between the posting
-- carrier and interested/booked carriers. Applied to dev via `db push`;
-- this file brings production in line during `prisma migrate deploy`.
--
-- Every message carries counterpartyTenantId — the conversation key that
-- keeps each carrier's negotiation private to that carrier.

-- CreateTable
CREATE TABLE "LoadMessage" (
    "id" TEXT NOT NULL,
    "loadId" TEXT NOT NULL,
    "authorTenantId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'MESSAGE',
    "proposedAmount" DECIMAL(18,6),
    "currency" TEXT,
    "readByPoster" BOOLEAN NOT NULL DEFAULT false,
    "readByOther" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "counterpartyTenantId" TEXT,

    CONSTRAINT "LoadMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoadMessage_loadId_counterpartyTenantId_createdAt_idx" ON "LoadMessage"("loadId", "counterpartyTenantId", "createdAt");

-- CreateIndex
CREATE INDEX "LoadMessage_authorTenantId_readByOther_idx" ON "LoadMessage"("authorTenantId", "readByOther");

-- CreateIndex
CREATE INDEX "LoadMessage_counterpartyTenantId_readByPoster_idx" ON "LoadMessage"("counterpartyTenantId", "readByPoster");

-- AddForeignKey
ALTER TABLE "LoadMessage" ADD CONSTRAINT "LoadMessage_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoadMessage" ADD CONSTRAINT "LoadMessage_authorTenantId_fkey" FOREIGN KEY ("authorTenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

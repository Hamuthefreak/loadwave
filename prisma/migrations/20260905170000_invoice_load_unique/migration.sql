-- CreateIndex
CREATE UNIQUE INDEX "Invoice_tenantId_loadId_key" ON "Invoice"("tenantId", "loadId");
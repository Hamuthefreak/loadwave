-- Ops 2FA enforcement + new-device tracking
ALTER TABLE "Tenant" ADD COLUMN "requireTwoFactor" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "User" ADD COLUMN "knownDevices" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
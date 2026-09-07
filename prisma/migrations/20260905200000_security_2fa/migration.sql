-- AlterTable
ALTER TABLE "RefreshToken" ADD COLUMN     "userAgent" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "twoFactorRecoveryCodes" TEXT,
ADD COLUMN     "twoFactorSecret" TEXT;
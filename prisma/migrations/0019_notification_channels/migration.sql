-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OutboxType" ADD VALUE 'SLACK';
ALTER TYPE "OutboxType" ADD VALUE 'SMS';
ALTER TYPE "OutboxType" ADD VALUE 'WHATSAPP';

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "slackWebhookUrlSealed" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notifyEmail" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifySms" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyWhatsapp" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "phoneE164" TEXT;

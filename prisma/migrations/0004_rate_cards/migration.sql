-- AlterTable
ALTER TABLE "ChangeImpact" ADD COLUMN     "overrideReason" TEXT,
ADD COLUMN     "pricing" JSONB,
ADD COLUMN     "rateCardId" TEXT,
ADD COLUMN     "templateId" TEXT;

-- CreateTable
CREATE TABLE "RateCard" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateCardEntry" (
    "id" TEXT NOT NULL,
    "rateCardId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "hourlyRateMinor" INTEGER NOT NULL,

    CONSTRAINT "RateCardEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstimateTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "contingencyPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxPct" DOUBLE PRECISION,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EstimateTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RateCard_organizationId_idx" ON "RateCard"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "RateCardEntry_rateCardId_role_key" ON "RateCardEntry"("rateCardId", "role");

-- CreateIndex
CREATE INDEX "EstimateTemplate_organizationId_idx" ON "EstimateTemplate"("organizationId");

-- AddForeignKey
ALTER TABLE "RateCard" ADD CONSTRAINT "RateCard_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateCardEntry" ADD CONSTRAINT "RateCardEntry_rateCardId_fkey" FOREIGN KEY ("rateCardId") REFERENCES "RateCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstimateTemplate" ADD CONSTRAINT "EstimateTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "AllowanceKind" AS ENUM ('HOURS', 'AMOUNT');

-- CreateEnum
CREATE TYPE "AllowancePoolStatus" AS ENUM ('PROPOSED', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "DrawDownStatus" AS ENUM ('NOTIFIED', 'OBJECTED', 'FINAL', 'RELEASED');

-- AlterTable
ALTER TABLE "ApprovalRequest" ADD COLUMN     "allowancePoolId" TEXT;

-- AlterTable
ALTER TABLE "ChangeRequest" ADD COLUMN     "drawAllowancePoolId" TEXT;

-- CreateTable
CREATE TABLE "AllowancePool" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AllowanceKind" NOT NULL,
    "totalHours" DOUBLE PRECISION,
    "totalMinor" INTEGER,
    "currency" TEXT,
    "objectionWindowHours" INTEGER NOT NULL DEFAULT 72,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" "AllowancePoolStatus" NOT NULL DEFAULT 'PROPOSED',
    "grantDecisionId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AllowancePool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllowanceDrawDown" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "changeRequestId" TEXT NOT NULL,
    "hours" DOUBLE PRECISION,
    "amountMinor" INTEGER,
    "status" "DrawDownStatus" NOT NULL DEFAULT 'NOTIFIED',
    "notifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "objectionDeadline" TIMESTAMP(3) NOT NULL,
    "objectionReason" TEXT,
    "objectedBy" TEXT,
    "objectedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AllowanceDrawDown_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AllowancePool_projectId_idx" ON "AllowancePool"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "AllowanceDrawDown_changeRequestId_key" ON "AllowanceDrawDown"("changeRequestId");

-- CreateIndex
CREATE INDEX "AllowanceDrawDown_poolId_idx" ON "AllowanceDrawDown"("poolId");

-- AddForeignKey
ALTER TABLE "AllowancePool" ADD CONSTRAINT "AllowancePool_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllowanceDrawDown" ADD CONSTRAINT "AllowanceDrawDown_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "AllowancePool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllowanceDrawDown" ADD CONSTRAINT "AllowanceDrawDown_changeRequestId_fkey" FOREIGN KEY ("changeRequestId") REFERENCES "ChangeRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

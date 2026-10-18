-- Proposal options (2-4 priced alternatives per change), the client's pick on
-- each approving vote + the terminal choice on the approval, and PARKED status.

-- AlterEnum
ALTER TYPE "ChangeStatus" ADD VALUE 'PARKED';

-- AlterTable
ALTER TABLE "ApprovalDecision" ADD COLUMN "optionId" TEXT;
ALTER TABLE "ApprovalRequest" ADD COLUMN "chosenOptionId" TEXT;

-- CreateTable
CREATE TABLE "ChangeOption" (
    "id" TEXT NOT NULL,
    "changeRequestId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "effortDays" DOUBLE PRECISION,
    "priceMinor" INTEGER,
    "currency" TEXT,
    "timelineDays" INTEGER,
    "milestoneEffect" TEXT,
    "risks" JSONB NOT NULL DEFAULT '[]',
    "exclusions" JSONB NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChangeOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChangeOption_changeRequestId_idx" ON "ChangeOption"("changeRequestId");

-- AddForeignKey
ALTER TABLE "ChangeOption" ADD CONSTRAINT "ChangeOption_changeRequestId_fkey" FOREIGN KEY ("changeRequestId") REFERENCES "ChangeRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

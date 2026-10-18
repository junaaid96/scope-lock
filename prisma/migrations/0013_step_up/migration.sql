-- Step-up verification on review links: hashed email-OTP challenges bound to
-- the approval + token + approver, and the typed confirmation name on decisions.

-- AlterTable
ALTER TABLE "ApprovalDecision" ADD COLUMN "typedName" TEXT;

-- CreateTable
CREATE TABLE "StepUpChallenge" (
    "id" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "tokenId" TEXT,
    "approverKey" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StepUpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StepUpChallenge_approvalRequestId_idx" ON "StepUpChallenge"("approvalRequestId");

-- AddForeignKey
ALTER TABLE "StepUpChallenge" ADD CONSTRAINT "StepUpChallenge_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

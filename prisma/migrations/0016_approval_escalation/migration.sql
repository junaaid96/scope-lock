-- Approval escalation: stalled SENT packages escalate exactly once.
-- escalatedAt records when (null = never); the delay/target live in the
-- project's settings JSON, so no backfill is needed.

-- AlterTable
ALTER TABLE "ApprovalRequest" ADD COLUMN "escalatedAt" TIMESTAMP(3);

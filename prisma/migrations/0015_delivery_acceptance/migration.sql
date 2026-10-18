-- Delivery acceptance: approval packages can cover delivered requirements
-- (acceptanceRequirementIds + package.acceptance snapshot), and the policy
-- can deem them accepted at the deadline (DEEMED terminal status + deemedAt).

-- AlterEnum
ALTER TYPE "ApprovalStatus" ADD VALUE 'DEEMED';

-- AlterTable
ALTER TABLE "ApprovalRequest" ADD COLUMN "acceptanceRequirementIds" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "ApprovalRequest" ADD COLUMN "deemedAt" TIMESTAMP(3);

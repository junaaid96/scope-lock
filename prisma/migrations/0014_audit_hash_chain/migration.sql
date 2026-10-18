-- Tamper-evident audit hash chain: per-project SHA-256 linkage (prevHash +
-- hash over canonical JSON, per-chain sequence) with a serialized chain-head
-- row. Existing events keep the explicit genesis marker with an empty hash
-- and sequence 0, i.e. they verify as pre-chain "legacy" rows.

-- AlterTable
ALTER TABLE "AuditEvent" ADD COLUMN "prevHash" TEXT NOT NULL DEFAULT 'GENESIS';
ALTER TABLE "AuditEvent" ADD COLUMN "hash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AuditEvent" ADD COLUMN "chainSeq" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "AuditChainHead" (
    "chainKey" TEXT NOT NULL,
    "headHash" TEXT NOT NULL,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditChainHead_pkey" PRIMARY KEY ("chainKey")
);

-- CreateIndex
CREATE INDEX "AuditEvent_projectId_chainSeq_idx" ON "AuditEvent"("projectId", "chainSeq");

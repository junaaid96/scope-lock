-- Decision memory: pgvector-backed semantic search over decided approvals.
-- The extension must exist before the vector column; semantic ranking only
-- runs when Postgres serves it and an embeddings provider is configured,
-- otherwise every backend falls back to lexical ranking.

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "DecisionEmbedding" (
    "id" TEXT NOT NULL,
    "approvalId" TEXT NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DecisionEmbedding_approvalId_key" ON "DecisionEmbedding"("approvalId");

-- AddForeignKey
ALTER TABLE "DecisionEmbedding" ADD CONSTRAINT "DecisionEmbedding_approvalId_fkey" FOREIGN KEY ("approvalId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Public intake links + anonymous submitter support on change requests.
ALTER TABLE "ChangeRequest" ALTER COLUMN "submitterId" DROP NOT NULL;
ALTER TABLE "ChangeRequest" ADD COLUMN "submitterName" TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN "submitterEmail" TEXT;
ALTER TABLE "ChangeRequest" ADD COLUMN "unverifiedSubmitter" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "IntakeLink" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "submissions" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntakeLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntakeLink_tokenHash_key" ON "IntakeLink"("tokenHash");
CREATE INDEX "IntakeLink_projectId_idx" ON "IntakeLink"("projectId");

-- AddForeignKey
ALTER TABLE "IntakeLink" ADD CONSTRAINT "IntakeLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IntakeLink" ADD CONSTRAINT "IntakeLink_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

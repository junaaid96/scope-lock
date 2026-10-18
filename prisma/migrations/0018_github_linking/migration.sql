-- CreateTable
CREATE TABLE "ExternalConnection" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "secretSealed" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalWorkItem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT,
    "title" TEXT,
    "refs" JSONB NOT NULL,
    "merged" BOOLEAN NOT NULL DEFAULT false,
    "mergedAt" TIMESTAMP(3),
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalWorkItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalConnection_projectId_idx" ON "ExternalConnection"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalConnection_projectId_provider_key" ON "ExternalConnection"("projectId", "provider");

-- CreateIndex
CREATE INDEX "ExternalWorkItem_projectId_idx" ON "ExternalWorkItem"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalWorkItem_projectId_provider_externalId_kind_key" ON "ExternalWorkItem"("projectId", "provider", "externalId", "kind");

-- AddForeignKey
ALTER TABLE "ExternalConnection" ADD CONSTRAINT "ExternalConnection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalWorkItem" ADD CONSTRAINT "ExternalWorkItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

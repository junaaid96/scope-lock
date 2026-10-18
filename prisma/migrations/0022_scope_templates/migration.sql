-- Scope templates: org-level requirement libraries (standard assumptions,
-- exclusions, and requirement items per project type) that instantiate
-- into a draft scope version.
CREATE TABLE "ScopeTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectType" TEXT NOT NULL,
    "description" TEXT,
    "assumptions" JSONB NOT NULL DEFAULT '[]',
    "exclusions" JSONB NOT NULL DEFAULT '[]',
    "items" JSONB NOT NULL DEFAULT '[]',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScopeTemplate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScopeTemplate_organizationId_idx" ON "ScopeTemplate"("organizationId");

ALTER TABLE "ScopeTemplate" ADD CONSTRAINT "ScopeTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Unguessable per-project inbound-email aliases.
CREATE TABLE "InboundMailbox" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "localPart" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundMailbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InboundMailbox_localPart_key" ON "InboundMailbox"("localPart");
CREATE INDEX "InboundMailbox_projectId_idx" ON "InboundMailbox"("projectId");

ALTER TABLE "InboundMailbox" ADD CONSTRAINT "InboundMailbox_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InboundMailbox" ADD CONSTRAINT "InboundMailbox_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

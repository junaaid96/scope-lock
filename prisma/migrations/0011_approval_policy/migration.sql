-- Approval policy per review package (ANY default preserves first-decision-wins).
ALTER TABLE "ApprovalRequest" ADD COLUMN "policy" JSONB NOT NULL DEFAULT '{"mode":"ANY","approverOrder":[]}';

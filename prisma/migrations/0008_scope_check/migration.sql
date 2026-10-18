-- Persist pre-submission scope-check suggestions for suggestion-vs-outcome metrics.
ALTER TABLE "ChangeRequest" ADD COLUMN "scopeCheckSuggestedIds" JSONB NOT NULL DEFAULT '[]';

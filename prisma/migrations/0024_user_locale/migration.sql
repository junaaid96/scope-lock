-- Per-user UI language. Existing users keep English; org/project review-link
-- defaults live in the schemaless settings JSON (no columns needed).
ALTER TABLE "User" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en';

-- Record which AI provider served each usage-log entry ("groq" | "openai" | "none").
ALTER TABLE "AIAnalysis" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'groq';

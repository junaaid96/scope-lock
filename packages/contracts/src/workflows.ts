import { z } from "zod";
import { IdSchema } from "./common.js";

// ---------- Files ----------
export const CreateUploadIntentSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1).max(160),
  sizeBytes: z.number().int().min(1).max(100 * 1024 * 1024),
  checksumSha256: z.string().regex(/^[0-9a-f]{64}$/i, "Expected a sha256 hex checksum"),
  linkedType: z.enum(["CHANGE", "REQUIREMENT", "EVIDENCE", "SCOPE_VERSION"]).optional(),
  linkedId: IdSchema.optional(),
});
export const CompleteUploadSchema = z.object({
  checksumSha256: z.string().regex(/^[0-9a-f]{64}$/i).optional(),
});

// ---------- AI ----------
export const ExtractRequirementsSchema = z.object({
  sourceText: z.string().min(20).max(60000),
  sourceLabel: z.string().min(1).max(200).default("proposal"),
});
export const ImportChangesSchema = z.object({
  sourceText: z.string().min(20).max(60000),
  sourceLabel: z.string().min(1).max(200).default("transcript"),
});
export const ClarifyQuestionsSchema = z.object({
  maxQuestions: z.number().int().min(1).max(10).default(5),
});
export const ProposalDraftSchema = z.object({
  tone: z.enum(["neutral", "formal", "friendly"]).default("neutral"),
});
export const ReviewAiAnalysisSchema = z.object({
  disposition: z.enum(["ACCEPTED", "EDITED", "DISMISSED"]),
});
export const ScopeCheckSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(8000),
});

// ---------- Activity / notes / export ----------
export const CreateDecisionNoteSchema = z.object({
  targetType: z.enum(["REQUIREMENT", "CHANGE", "SCOPE_VERSION", "PROJECT"]),
  targetId: IdSchema,
  body: z.string().min(1).max(8000),
});
export const UpdateDecisionNoteSchema = z.object({
  body: z.string().min(1).max(8000),
});

// ---------- External links (P2) ----------
export const CreateExternalLinkSchema = z.object({
  changeRequestId: IdSchema,
  provider: z.enum(["JIRA", "LINEAR", "GITHUB", "TRELLO", "OTHER"]),
  externalId: z.string().min(1).max(200),
  url: z.string().url().max(2000).optional(),
});

// ---------- Notifications ----------
export const MarkNotificationReadSchema = z.object({ read: z.boolean().default(true) });

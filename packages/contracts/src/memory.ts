import { z } from "zod";
import { IdSchema } from "./common.js";

// ---------- Decision memory search ----------

export const MemorySearchQuerySchema = z.object({
  q: z.string().min(2).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const MemorySearchResultSchema = z.object({
  approvalId: IdSchema,
  projectId: IdSchema,
  projectName: z.string(),
  changeId: z.string().nullable(),
  changeNumber: z.string().nullable(),
  title: z.string(),
  outcome: z.string(),
  decidedAt: z.string(),
  /** Verbatim slice of stored text — never generated. */
  excerpt: z.string(),
  link: z.string(),
});

export const MemorySearchResponseSchema = z.object({
  query: z.string(),
  mode: z.enum(["lexical", "semantic"]),
  data: z.array(MemorySearchResultSchema),
});

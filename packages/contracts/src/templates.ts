import { z } from "zod";
import { IdSchema } from "./common.js";

// ---------- Scope templates + CSV import ----------

export const ScopeTemplateItemSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(8000),
  acceptanceCriteria: z.array(z.string().min(1).max(1000)).max(50).default([]),
  category: z.string().max(80).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
});

export const CreateScopeTemplateSchema = z.object({
  name: z.string().min(1).max(160),
  /** Project type this template fits (free-form, e.g. "Website"). */
  projectType: z.string().min(1).max(80),
  description: z.string().max(2000).optional(),
  assumptions: z.array(z.string().min(1).max(1000)).max(50).default([]),
  exclusions: z.array(z.string().min(1).max(1000)).max(50).default([]),
  items: z.array(ScopeTemplateItemSchema).max(100).default([]),
});

export const UpdateScopeTemplateSchema = CreateScopeTemplateSchema.partial();

export const ScopeTemplateViewSchema = z.object({
  id: IdSchema,
  organizationId: IdSchema,
  name: z.string(),
  projectType: z.string(),
  description: z.string().nullable(),
  assumptions: z.array(z.string()),
  exclusions: z.array(z.string()),
  items: z.array(
    ScopeTemplateItemSchema.extend({ category: z.string().nullable(), priority: z.string().nullable() }),
  ),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const InstantiateTemplateSchema = z.object({
  templateId: IdSchema,
  /** Scope document name for the new draft. */
  name: z.string().min(1).max(160).default("Scope"),
});

export const CsvImportSchema = z.object({
  draftVersionId: IdSchema,
  /** Raw CSV text: title, description, acceptanceCriteria (| separated), category, priority, stableKey. */
  csv: z.string().min(1).max(512 * 1024),
  /** True previews without writing; false imports atomically (all rows or none). */
  dryRun: z.boolean().default(true),
});

export const CsvRowErrorSchema = z.object({
  /** 1-based data row number (header is not counted). */
  row: z.number().int().min(1),
  field: z.string(),
  message: z.string(),
});

export const CsvImportResponseSchema = z.object({
  dryRun: z.boolean(),
  totalRows: z.number().int(),
  validRows: z.number().int(),
  imported: z.number().int(),
  errors: z.array(CsvRowErrorSchema),
  /** Stable keys minted by a real import (empty on dry runs and failures). */
  stableKeys: z.array(z.string()),
});

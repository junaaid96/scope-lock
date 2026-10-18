import { z } from "zod";
import { IdSchema, MinorUnitsSchema } from "./common.js";

// ---------- Actuals + price suggestions ----------

/** Optional actuals recorded on an implemented change. All fields nullable-cleared. */
export const RecordActualsSchema = z.object({
  actualEffortDays: z.number().min(0).max(1000000).nullable().optional(),
  actualPriceMinor: MinorUnitsSchema.nullable().optional(),
  actualNotes: z.string().max(2000).nullable().optional(),
});

export const ActualsViewSchema = z.object({
  actualEffortDays: z.number().nullable(),
  actualPriceMinor: MinorUnitsSchema.nullable(),
  actualCurrency: z.string().nullable(),
  actualNotes: z.string().nullable(),
});

/** One comparable: a similar approved change with its REAL approved price. */
export const PriceComparableSchema = z.object({
  changeId: IdSchema,
  changeNumber: z.string(),
  title: z.string(),
  approvedPriceMinor: MinorUnitsSchema,
  currency: z.string(),
  effortDays: z.number().nullable(),
  decidedAt: z.string(),
  link: z.string(),
  sharedTerms: z.array(z.string()),
});

export const PriceSuggestionsResponseSchema = z.object({
  changeId: IdSchema,
  currency: z.string(),
  /** Ranked comparables — the suggestion IS this list; no generated number. */
  data: z.array(PriceComparableSchema),
});

export const EstimateVsActualRowSchema = z.object({
  changeId: IdSchema,
  changeNumber: z.string(),
  title: z.string(),
  estimateMinor: MinorUnitsSchema.nullable(),
  actualMinor: MinorUnitsSchema.nullable(),
  varianceMinor: z.number().int().nullable(),
  variancePct: z.number().nullable(),
  estimateDays: z.number().nullable(),
  actualDays: z.number().nullable(),
  daysVariance: z.number().nullable(),
  link: z.string(),
});

export const EstimateVsActualResponseSchema = z.object({
  projectId: IdSchema,
  currency: z.string(),
  data: z.array(EstimateVsActualRowSchema),
  totals: z.object({
    estimateMinor: MinorUnitsSchema,
    actualMinor: MinorUnitsSchema,
    varianceMinor: z.number().int(),
    rowsWithActuals: z.number().int(),
    rowsTotal: z.number().int(),
  }),
});

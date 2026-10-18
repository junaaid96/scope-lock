import { z } from "zod";
import { CurrencySchema, IdSchema, MinorUnitsSchema } from "./common.js";

// ---------- Rate cards ----------

export const RateEntrySchema = z.object({
  role: z.string().min(1).max(80),
  hourlyRateMinor: MinorUnitsSchema,
});

export const CreateRateCardSchema = z.object({
  name: z.string().min(1).max(160),
  currency: CurrencySchema,
  rates: z.array(RateEntrySchema).min(1).max(100),
  isDefault: z.boolean().default(false),
});

export const UpdateRateCardSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  currency: CurrencySchema.optional(),
  /** Replace-all rate table. */
  rates: z.array(RateEntrySchema).min(1).max(100).optional(),
  isDefault: z.boolean().optional(),
});

// ---------- Estimate templates ----------

export const TemplateItemSchema = z.object({
  label: z.string().min(1).max(160),
  role: z.string().min(1).max(80),
  hours: z.number().min(0).max(1000000),
});

export const PctSchema = z.number().min(0).max(100);

export const CreateEstimateTemplateSchema = z.object({
  name: z.string().min(1).max(160),
  items: z.array(TemplateItemSchema).min(1).max(100),
  contingencyPct: PctSchema.default(0),
  taxPct: PctSchema.nullable().optional(),
});

export const UpdateEstimateTemplateSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  items: z.array(TemplateItemSchema).min(1).max(100).optional(),
  contingencyPct: PctSchema.optional(),
  taxPct: PctSchema.nullable().optional(),
});

// ---------- Computed impact pricing ----------

export const PricingInputSchema = z.object({
  rateCardId: IdSchema,
  templateId: IdSchema.optional(),
  /** Edited line items. When omitted, the template's items are used as-is. */
  lineItems: z.array(TemplateItemSchema).min(1).max(100).optional(),
});

export const PricingOverrideSchema = z.object({
  priceMinor: MinorUnitsSchema,
  reason: z.string().min(1).max(2000),
});

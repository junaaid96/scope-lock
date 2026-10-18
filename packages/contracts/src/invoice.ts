import { z } from "zod";
import { IsoDateSchema } from "./common.js";

/** Period bounds accept calendar dates (2026-01-31) or full timestamps. */
export const PeriodDateSchema = z.union([IsoDateSchema, z.string().date()]);

export const InvoiceExportQuerySchema = z
  .object({
    from: PeriodDateSchema,
    to: PeriodDateSchema,
    format: z.enum(["json", "csv"]).default("json"),
  })
  .refine((q) => Date.parse(q.from) <= Date.parse(q.to), {
    message: "from must not be after to",
    path: ["from"],
  });

export const InvoiceLineSchema = z.object({
  number: z.string(),
  title: z.string(),
  decidedAt: IsoDateSchema,
  priceMinor: z.number().int(),
  price: z.string(),
  currency: z.string(),
  pricingMode: z.string().nullable(),
  overrideReason: z.string().nullable(),
  allowancePoolName: z.string().nullable(),
  drawStatus: z.string().nullable(),
});

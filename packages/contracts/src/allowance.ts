import { z } from "zod";
import { CurrencySchema, IdSchema, IsoDateSchema, MinorUnitsSchema } from "./common.js";

// ---------- Change allowance pools ----------

export const AllowanceKindSchema = z.enum(["HOURS", "AMOUNT"]);

const AllowanceTermsShape = {
  kind: AllowanceKindSchema,
  totalHours: z.number().positive().max(1000000).nullable().optional(),
  totalMinor: MinorUnitsSchema.nullable().optional(),
  currency: CurrencySchema.nullable().optional(),
};

function refineTerms(v: z.infer<z.ZodObject<typeof AllowanceTermsShape>>, ctx: z.RefinementCtx): void {
    if (v.kind === "HOURS") {
      if (v.totalHours === null || v.totalHours === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "HOURS pools need totalHours" });
      }
      if (v.totalMinor !== null && v.totalMinor !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "HOURS pools take no totalMinor" });
      }
    } else {
      if (v.totalMinor === null || v.totalMinor === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "AMOUNT pools need totalMinor" });
      }
      if (!v.currency) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "AMOUNT pools need an explicit currency" });
      }
      if (v.totalHours !== null && v.totalHours !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "AMOUNT pools take no totalHours" });
      }
    }
}

export const CreateAllowancePoolSchema = z
  .object({
    ...AllowanceTermsShape,
    name: z.string().min(1).max(160),
    objectionWindowHours: z.number().int().min(1).max(24 * 90).default(72),
    /** Off by default: pools draw nothing until the agency enables them. */
    enabled: z.boolean().default(false),
  })
  .superRefine(refineTerms);

export const UpdateAllowancePoolSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  totalHours: z.number().positive().max(1000000).nullable().optional(),
  totalMinor: MinorUnitsSchema.nullable().optional(),
  objectionWindowHours: z.number().int().min(1).max(24 * 90).optional(),
  enabled: z.boolean().optional(),
  status: z.enum(["PROPOSED", "ACTIVE", "CLOSED"]).optional(),
});

export const ObjectDrawDownSchema = z.object({
  reason: z.string().min(1).max(2000),
});

export const ResolveDrawDownSchema = z.object({
  resolution: z.enum(["UPHOLD", "RELEASE"]),
  note: z.string().min(1).max(2000),
});

export const PoolBalanceSchema = z.object({
  kind: AllowanceKindSchema,
  remainingHours: z.number().nullable(),
  remainingMinor: MinorUnitsSchema.nullable(),
  exhausted: z.boolean(),
});

export const AllowancePoolSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  name: z.string(),
  kind: AllowanceKindSchema,
  totalHours: z.number().nullable(),
  totalMinor: MinorUnitsSchema.nullable(),
  currency: CurrencySchema.nullable(),
  objectionWindowHours: z.number(),
  enabled: z.boolean(),
  status: z.enum(["PROPOSED", "ACTIVE", "CLOSED"]),
  grantDecisionId: IdSchema.nullable(),
  createdBy: IdSchema,
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  balance: PoolBalanceSchema,
  drawDowns: z.array(
    z.object({
      id: IdSchema,
      poolId: IdSchema,
      changeRequestId: IdSchema,
      changeNumber: z.string(),
      changeTitle: z.string(),
      hours: z.number().nullable(),
      amountMinor: MinorUnitsSchema.nullable(),
      status: z.enum(["NOTIFIED", "OBJECTED", "FINAL", "RELEASED"]),
      notifiedAt: IsoDateSchema,
      objectionDeadline: IsoDateSchema,
      objectionReason: z.string().nullable(),
      resolutionNote: z.string().nullable(),
      resolvedAt: IsoDateSchema.nullable(),
    }),
  ),
});

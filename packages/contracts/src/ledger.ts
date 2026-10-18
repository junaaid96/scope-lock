import { z } from "zod";
import { CurrencySchema, IdSchema, IsoDateSchema, MinorUnitsSchema } from "./common.js";

// ---------- Contract value ledger (derived; see @scopelock/domain ledger) ----------

export const LedgerDeltaSchema = z.object({
  changeId: IdSchema,
  number: z.string(),
  title: z.string(),
  priceMinor: MinorUnitsSchema,
  decidedAt: IsoDateSchema,
  amendmentVersionId: IdSchema.nullable(),
});

export const LedgerPendingSchema = z.object({
  changeId: IdSchema,
  number: z.string(),
  title: z.string(),
  priceMinor: MinorUnitsSchema,
  status: z.string(),
});

export const LedgerAbsorbedSchema = z.object({
  changeId: IdSchema,
  number: z.string(),
  title: z.string(),
  effortDays: z.number().nullable(),
  decidedAt: IsoDateSchema,
});

export const LedgerExclusionSchema = z.object({
  changeId: IdSchema,
  number: z.string(),
  reason: z.enum(["CURRENCY_MISMATCH", "UNPRICED", "NOT_APPROVED"]),
  detail: z.string(),
});

export const VersionValueSchema = z.object({
  scopeVersionId: IdSchema,
  sequence: z.number().int(),
  status: z.string(),
  title: z.string().nullable(),
  deltaMinor: MinorUnitsSchema,
  changeNumbers: z.array(z.string()),
});

export const ContractLedgerSchema = z.object({
  currency: CurrencySchema,
  baselineMinor: MinorUnitsSchema.nullable(),
  approvedDeltaMinor: MinorUnitsSchema,
  currentMinor: MinorUnitsSchema.nullable(),
  pendingExposureMinor: MinorUnitsSchema,
  unattributedMinor: MinorUnitsSchema,
  unattributedNumbers: z.array(z.string()),
  absorbedEffortDays: z.number(),
  absorbedCount: z.number().int().min(0),
  deltas: z.array(LedgerDeltaSchema),
  pending: z.array(LedgerPendingSchema),
  absorbed: z.array(LedgerAbsorbedSchema),
  excluded: z.array(LedgerExclusionSchema),
  byVersion: z.array(VersionValueSchema),
});

export const ProjectLedgerSummarySchema = z.object({
  projectId: IdSchema,
  name: z.string(),
  currency: CurrencySchema,
  baselineMinor: MinorUnitsSchema.nullable(),
  currentMinor: MinorUnitsSchema.nullable(),
  pendingExposureMinor: MinorUnitsSchema,
  absorbedCount: z.number().int().min(0),
});

export const OrgContractRollupSchema = z.object({
  projects: z.array(ProjectLedgerSummarySchema),
  totalsByCurrency: z.array(
    z.object({
      currency: CurrencySchema,
      projectCount: z.number().int().min(0),
      baselineMinor: MinorUnitsSchema,
      currentMinor: MinorUnitsSchema,
      pendingExposureMinor: MinorUnitsSchema,
    }),
  ),
});

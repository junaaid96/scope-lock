import { z } from "zod";
import {
  ChangeClassificationSchema,
  ChangeStatusSchema,
  ConfidenceSchema,
  CurrencySchema,
  EvidenceStatusSchema,
  EvidenceTypeSchema,
  IdSchema,
  IsoDateSchema,
  LinkConditionSchema,
  LinkKindSchema,
  MinorUnitsSchema,
  RequirementStatusSchema,
} from "./common.js";
import { PricingInputSchema, PricingOverrideSchema } from "./pricing.js";

// ---------- Scope versions ----------
export const CreateDraftVersionSchema = z.object({
  scopeDocumentId: IdSchema.optional(),
  documentName: z.string().min(1).max(160).optional(),
  title: z.string().max(200).optional(),
  summary: z.string().max(4000).optional(),
  copyFromVersionId: IdSchema.optional(),
});
export const UpdateDraftVersionSchema = z.object({
  expectedVersion: z.number().int().min(0),
  title: z.string().max(200).optional(),
  summary: z.string().max(4000).optional(),
  assumptions: z.array(z.string().min(1).max(1000)).max(100).optional(),
  exclusions: z.array(z.string().min(1).max(1000)).max(100).optional(),
});
export const PublishVersionSchema = z.object({ expectedVersion: z.number().int().min(0) });

// ---------- Requirements ----------
const RequirementContentSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(8000),
  acceptanceCriteria: z.array(z.string().min(1).max(1000)).max(50).default([]),
  category: z.string().max(80).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  order: z.number().int().min(0).max(100000).default(0),
});

export const CreateRequirementSchema = RequirementContentSchema.extend({
  draftVersionId: IdSchema,
  stableKey: z
    .string()
    .regex(/^[A-Z0-9-]{1,24}$/, "Stable key like REQ-001")
    .optional(),
});
export const UpsertDraftRevisionSchema = RequirementContentSchema.partial().extend({
  requirementId: IdSchema.optional(),
  expectedVersion: z.number().int().min(0),
});
export const UpdateRequirementStatusSchema = z.object({ status: RequirementStatusSchema });

export const CreateEvidenceSchema = z.object({
  type: EvidenceTypeSchema,
  title: z.string().min(1).max(200),
  url: z.string().url().max(2000).optional(),
  attachmentId: IdSchema.optional(),
  note: z.string().max(4000).optional(),
});
export const UpdateEvidenceSchema = z.object({ status: EvidenceStatusSchema });

// ---------- Change requests ----------
export const CreateChangeSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(12000),
  source: z.enum(["CLIENT", "AGENCY"]).default("CLIENT"),
});
export const UpdateChangeSchema = z.object({
  expectedVersion: z.number().int().min(0),
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(12000).optional(),
  status: ChangeStatusSchema.optional(),
  classification: ChangeClassificationSchema.nullable().optional(),
  classificationRationale: z.string().max(2000).nullable().optional(),
});
export const SubmitChangeSchema = z.object({ expectedVersion: z.number().int().min(0) });

export const UpsertImpactSchema = z.object({
  expectedVersion: z.number().int().min(0).optional(),
  effortDays: z.number().min(0).max(3650).optional(),
  /** Manual price. Ignored when `pricing` computes one (unless `override` replaces it). */
  priceMinor: MinorUnitsSchema.nullable().optional(),
  pricing: PricingInputSchema.optional(),
  override: PricingOverrideSchema.optional(),
  currency: CurrencySchema.optional(),
  timelineDays: z.number().int().min(0).max(3650).optional(),
  milestoneEffect: z.string().max(2000).optional(),
  risks: z.array(z.string().min(1).max(1000)).max(50).default([]),
  exclusions: z.array(z.string().min(1).max(1000)).max(50).default([]),
  notes: z.string().max(8000).optional(),
  confidence: ConfidenceSchema.default("MEDIUM"),
});

export const CreateChangeLinkSchema = z.object({
  targetType: z.enum(["REQUIREMENT", "CHANGE"]),
  targetRequirementId: IdSchema.optional(),
  targetChangeId: IdSchema.optional(),
  scopeVersionId: IdSchema.optional(),
  kind: LinkKindSchema.default("AFFECTS"),
  condition: LinkConditionSchema.optional(),
  overrideRationale: z.string().max(2000).optional(),
});

export const CreateClarificationSchema = z.object({
  question: z.string().min(1).max(2000),
});
export const AnswerClarificationSchema = z.object({
  answer: z.string().min(1).max(8000),
});

export const ConvertToScopeSchema = z.object({
  scopeDocumentId: IdSchema.optional(),
  title: z.string().max(200).optional(),
  // Link to an existing DRAFT version instead of creating a new amendment draft.
  scopeVersionId: IdSchema.optional(),
});

// ---------- Bundles ----------
export const CreateBundleSchema = z.object({
  name: z.string().min(1).max(160),
  changeRequestIds: z.array(IdSchema).min(1).max(50),
  adjustmentMinor: z.number().int().min(-1000000000).max(1000000000).default(0),
  adjustmentNote: z.string().max(2000).optional(),
});
export const UpdateBundleSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  adjustmentMinor: z.number().int().min(-1000000000).max(1000000000).optional(),
  adjustmentNote: z.string().max(2000).nullable().optional(),
});
export const BundleMemberSchema = z.object({ changeRequestId: IdSchema });

// ---------- Review / approvals ----------
export const SendApprovalSchema = z.object({
  approverUserIds: z.array(IdSchema).min(1).max(10),
  approverEmails: z.array(z.string().email()).max(10).default([]),
  expiresAt: IsoDateSchema,
  title: z.string().max(200).optional(),
});
export const DecideApprovalSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED", "CHANGES_REQUESTED"]),
  comment: z.string().max(4000).optional(),
  /** The client must explicitly confirm the decision. */
  confirm: z.literal(true),
});

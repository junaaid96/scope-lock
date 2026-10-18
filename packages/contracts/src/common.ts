import { z } from "zod";

export const IdSchema = z.string().min(1).max(80);
export const EmailSchema = z.string().email().max(254);
export const CursorSchema = z.string().min(1).max(500).optional();
export const LimitSchema = z.coerce.number().int().min(1).max(100).default(25);
export const IsoDateSchema = z.string().datetime({ offset: true });
export const CurrencySchema = z.string().regex(/^[A-Z]{3}$/, "Use an ISO 4217 code, e.g. USD");
/** UI locales with full catalogs. */
export const LocaleSchema = z.enum(["en", "bn"]);
export const MinorUnitsSchema = z.number().int().min(0);
export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const HttpsUrlSchema = z.string().url().refine((u) => u.startsWith("https://"), {
  message: "Must be an https:// URL",
});

export const OrgRoleSchema = z.enum(["OWNER", "ADMIN", "MEMBER", "CLIENT"]);
export const ProjectRoleSchema = z.enum([
  "LEAD",
  "MEMBER",
  "CLIENT_ADMIN",
  "CLIENT_APPROVER",
  "CLIENT_VIEWER",
]);
export const ProjectStatusSchema = z.enum(["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"]);
export const ScopeVersionStatusSchema = z.enum(["DRAFT", "PUBLISHED", "SUPERSEDED"]);
export const RequirementStatusSchema = z.enum([
  "PROPOSED",
  "AGREED",
  "IN_PROGRESS",
  "DELIVERED",
  "ACCEPTED",
  "OUT_OF_SCOPE",
]);
export const ChangeStatusSchema = z.enum([
  "DRAFT",
  "SUBMITTED",
  "TRIAGING",
  "NEEDS_CLARIFICATION",
  "ESTIMATING",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "PARKED",
  "WITHDRAWN",
  "IMPLEMENTED",
]);
export const ChangeClassificationSchema = z.enum([
  "IN_SCOPE",
  "POTENTIAL_CHANGE",
  "DUPLICATE",
  "NEEDS_CLARIFICATION",
]);
export const ApprovalStatusSchema = z.enum(["DRAFT", "SENT", "DECIDED", "EXPIRED", "INVALIDATED"]);
export const ApprovalDecisionSchema = z.enum(["APPROVED", "REJECTED", "CHANGES_REQUESTED"]);
export const LinkKindSchema = z.enum(["AFFECTS", "DUPLICATE_OF", "RELATED", "DEPENDS_ON"]);
export const LinkConditionSchema = z.enum(["PREREQ_APPROVED", "PREREQ_IMPLEMENTED"]);
export const EvidenceTypeSchema = z.enum(["URL", "FILE", "NOTE", "TEST_RESULT"]);
export const EvidenceStatusSchema = z.enum(["PENDING", "REVIEWED", "ACCEPTED"]);
export const ConfidenceSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export const BundleStatusSchema = z.enum(["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED"]);
export const PlanSchema = z.enum(["FREE", "PRO", "SCALE"]);

/** Standard list envelope: `{ data, pagination: { nextCursor } }`. */
export function listEnvelope<T extends z.ZodTypeAny>(item: T): z.ZodTypeAny {
  return z.object({ data: z.array(item), pagination: z.object({ nextCursor: z.string().nullable() }) });
}

/** Standard list query: opaque cursor + bounded limit. */
export const ListQuerySchema = z.object({
  cursor: CursorSchema,
  limit: LimitSchema,
});
export type ListQueryInput = z.infer<typeof ListQuerySchema>;

/** Standard error envelope: `{ error: { code, message, correlationId, details? } }`. */
export const ErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    correlationId: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

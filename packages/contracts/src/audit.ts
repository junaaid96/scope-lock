import { z } from "zod";

/** GET /projects/:id/audit/verify — tamper-evidence report for the project chain. */
export const AuditVerifyResponseSchema = z.object({
  chainKey: z.string(),
  events: z.number().int().nonnegative(),
  chained: z.number().int().nonnegative(),
  legacy: z.number().int().nonnegative(),
  valid: z.boolean(),
  breakAtSeq: z.number().int().positive().nullable(),
  reason: z.string().nullable(),
  headHash: z.string().nullable(),
  headSeq: z.number().int().nonnegative().nullable(),
  verifiedAt: z.string(),
});

export type AuditVerifyResponse = z.infer<typeof AuditVerifyResponseSchema>;

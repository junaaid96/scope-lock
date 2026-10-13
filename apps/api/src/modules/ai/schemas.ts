import { z } from "zod";

/** Structured AI outputs — every response is validated before use. */

export const ExtractRequirementsResponseSchema = z.object({
  requirements: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        description: z.string().min(1).max(4000),
        acceptanceCriteria: z.array(z.string().min(1).max(500)).max(20).default([]),
        category: z.string().max(80).optional(),
        priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
      }),
    )
    .max(50),
  assumptions: z.array(z.string().min(1).max(500)).max(30).default([]),
  exclusions: z.array(z.string().min(1).max(500)).max(30).default([]),
});
export type ExtractRequirementsResponse = z.infer<typeof ExtractRequirementsResponseSchema>;

export const DriftAnalysisResponseSchema = z.object({
  links: z
    .array(
      z.object({
        requirementId: z.string().min(1),
        confidence: z.number().min(0).max(1),
        explanation: z.string().min(1).max(1000),
      }),
    )
    .max(20),
  missingContext: z.array(z.string().min(1).max(500)).max(20).default([]),
  suggestedClassification: z.enum(["IN_SCOPE", "POTENTIAL_CHANGE", "DUPLICATE", "NEEDS_CLARIFICATION"]).optional(),
});
export type DriftAnalysisResponse = z.infer<typeof DriftAnalysisResponseSchema>;

export const ClarificationsResponseSchema = z.object({
  questions: z.array(z.string().min(1).max(500)).min(1).max(10),
});
export type ClarificationsResponse = z.infer<typeof ClarificationsResponseSchema>;

export const ProposalDraftResponseSchema = z.object({
  subject: z.string().min(1).max(200),
  summary: z.string().min(1).max(4000),
  bullets: z.array(z.string().min(1).max(500)).max(20).default([]),
  nextSteps: z.string().max(2000).optional(),
});
export type ProposalDraftResponse = z.infer<typeof ProposalDraftResponseSchema>;

export const MemoryResponseSchema = z.object({
  relevantDecisions: z
    .array(
      z.object({
        approvalId: z.string().min(1),
        changeTitle: z.string().min(1),
        decision: z.enum(["APPROVED", "REJECTED", "CHANGES_REQUESTED"]),
        summary: z.string().min(1).max(1000),
      }),
    )
    .max(10),
  note: z.string().max(2000).optional(),
});
export type MemoryResponse = z.infer<typeof MemoryResponseSchema>;

export const CompareResponseSchema = z.object({
  summary: z.string().min(1).max(4000),
  highlights: z.array(z.string().min(1).max(500)).max(20).default([]),
});
export type CompareResponse = z.infer<typeof CompareResponseSchema>;

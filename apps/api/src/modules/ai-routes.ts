import { Router } from "express";
import { z } from "zod";
import {
  ClarifyQuestionsSchema,
  ExtractRequirementsSchema,
  ImportChangesSchema,
  ListQuerySchema,
  ProposalDraftSchema,
  ReviewAiAnalysisSchema,
  ScopeCheckSchema,
} from "@scopelock/contracts";
import { DomainError } from "@scopelock/domain";
import type { AppContext } from "../app-context.js";
import { asyncHandler } from "../http/errors.js";
import { authenticate, requireAuth } from "../http/auth.js";
import { requireAction, requireProjectAccess } from "../http/access.js";
import { rateLimit } from "../http/rate-limit.js";
import { validateBody, validateParams, validateQuery } from "../http/validate.js";
import { paginateList } from "../http/pagination.js";
import type { ApiRequest } from "../http/types.js";
import { audit } from "../lib/audit.js";
import type { AiContext } from "./ai/service.js";
import {
  analyzeScopeDrift,
  draftProposal,
  extractRequirements,
  generateClarifications,
  importChangeDrafts,
  summarizeMemory,
} from "./ai/service.js";
import { buildDriftCandidates } from "./scope.js";

async function aiContext(ctx: AppContext, auth: { user: { id: string } }, projectId: string): Promise<AiContext & { projectId: string }> {
  const access = await requireProjectAccess(ctx.store, auth.user.id, projectId);
  requireAction(access.access, "ai.use");
  const user = await ctx.store.findUserById(auth.user.id);
  if (!user) throw DomainError.unauthorized("Authentication required");
  return {
    store: ctx.store,
    env: ctx.env,
    user,
    project: access.project,
    organizationId: access.org.id,
    plan: access.org.plan,
    orgAiEnabled: access.org.aiEnabled,
    projectId: access.project.id,
  };
}

export function aiRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use(authenticate(ctx.store));

  router.post(
    "/projects/:id/ai/extract-requirements",
    requireAuth,
    rateLimit(ctx.env, "ai"),
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(ExtractRequirementsSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof ExtractRequirementsSchema>;
      const actx = await aiContext(ctx, auth, req.params.id as string);
      const analysis = await extractRequirements(actx, input.sourceText, input.sourceLabel);
      res.json({ analysis });
    }),
  );

  router.post(
    "/projects/:id/ai/import-changes",
    requireAuth,
    rateLimit(ctx.env, "ai"),
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(ImportChangesSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof ImportChangesSchema>;
      const actx = await aiContext(ctx, auth, req.params.id as string);
      const analysis = await importChangeDrafts(actx, input.sourceText, input.sourceLabel);
      res.json({ analysis });
    }),
  );

  router.post(
    "/change-requests/:id/ai/scope-analysis",
    requireAuth,
    rateLimit(ctx.env, "ai"),
    validateParams(z.object({ id: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const change = await ctx.store.findChangeById(req.params.id as string);
      if (!change) throw DomainError.notFound("Change request not found");
      const actx = await aiContext(ctx, auth, change.projectId);
      // Only authorized project records enter the prompt: governing revisions + the request text.
      const { candidates } = await buildDriftCandidates(ctx.store, change.projectId);
      const { analysis, deterministic } = await analyzeScopeDrift(
        actx,
        change.id,
        `${change.title}\n\n${change.description}`,
        candidates,
      );
      res.json({ analysis, deterministic });
    }),
  );

  // Pre-submission scope check: advisory only, never blocks creation.
  router.post(
    "/projects/:id/ai/scope-check",
    requireAuth,
    rateLimit(ctx.env, "ai"),
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(ScopeCheckSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof ScopeCheckSchema>;
      const actx = await aiContext(ctx, auth, req.params.id as string);
      const { version, candidates } = await buildDriftCandidates(ctx.store, actx.projectId);
      const { analysis, deterministic } = await analyzeScopeDrift(
        actx,
        null,
        `${input.title}\n\n${input.description}`,
        candidates,
      );
      res.json({
        analysis,
        deterministic,
        baseline: version ? { id: version.id, sequence: version.sequence } : null,
      });
    }),
  );

  router.post(
    "/change-requests/:id/ai/clarifications",
    requireAuth,
    rateLimit(ctx.env, "ai"),
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(ClarifyQuestionsSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof ClarifyQuestionsSchema>;
      const change = await ctx.store.findChangeById(req.params.id as string);
      if (!change) throw DomainError.notFound("Change request not found");
      const actx = await aiContext(ctx, auth, change.projectId);
      const analysis = await generateClarifications(
        actx,
        change.id,
        `${change.title}\n\n${change.description}`,
        input.maxQuestions,
      );
      res.json({ analysis });
    }),
  );

  router.post(
    "/change-requests/:id/ai/proposal-draft",
    requireAuth,
    rateLimit(ctx.env, "ai"),
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(ProposalDraftSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof ProposalDraftSchema>;
      const change = await ctx.store.findChangeById(req.params.id as string);
      if (!change) throw DomainError.notFound("Change request not found");
      const actx = await aiContext(ctx, auth, change.projectId);
      const impact = await ctx.store.findLatestImpact(change.id);
      if (!impact) throw DomainError.unprocessable("Record an impact assessment before drafting a proposal");
      const analysis = await draftProposal(
        actx,
        change.id,
        `${change.title}\n\n${change.description}`,
        {
          priceMinor: impact.priceMinor,
          currency: impact.currency,
          effortDays: impact.effortDays,
          timelineDays: impact.timelineDays,
          milestoneEffect: impact.milestoneEffect,
          risks: impact.risks,
          exclusions: impact.exclusions,
          notes: impact.notes,
          confidence: impact.confidence,
        },
        input.tone,
      );
      res.json({ analysis });
    }),
  );

  router.post(
    "/projects/:id/ai/decision-memory",
    requireAuth,
    rateLimit(ctx.env, "ai"),
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(z.object({ question: z.string().min(1).max(1000) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as { question: string };
      const actx = await aiContext(ctx, auth, req.params.id as string);
      const decisions = await ctx.store.listDecisionsWithContext(actx.projectId);
      const approvals = await ctx.store.listProjectApprovals(actx.projectId);
      const byId = new Map(approvals.map((a) => [a.id, a]));
      const history = decisions.slice(0, 20).map((d) => ({
        approvalId: d.approvalRequestId,
        changeTitle: byId.get(d.approvalRequestId)?.title ?? "Review package",
        decision: d.decision,
        summary: d.comment ?? "(no comment)",
      }));
      const analysis = await summarizeMemory(actx, input.question, history);
      res.json({ analysis });
    }),
  );

  router.get(
    "/projects/:id/ai/analyses",
    requireAuth,
    rateLimit(ctx.env, "ai"),
    validateParams(z.object({ id: z.string().min(1) })),
    validateQuery(ListQuerySchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const q = (req as ApiRequest).validatedQuery as { cursor?: string; limit: number };
      await aiContext(ctx, auth, req.params.id as string);
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      res.json(paginateList(await ctx.store.listAIAnalyses(access.project.id), q));
    }),
  );

  router.patch(
    "/projects/:id/ai/analyses/:analysisId",
    requireAuth,
    rateLimit(ctx.env, "ai"),
    validateParams(z.object({ id: z.string().min(1), analysisId: z.string().min(1) })),
    validateBody(ReviewAiAnalysisSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof ReviewAiAnalysisSchema>;
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "ai.review");
      const analysis = await ctx.store.findAIAnalysisById(req.params.analysisId as string);
      if (!analysis || analysis.projectId !== access.project.id) throw DomainError.notFound("AI analysis not found");
      const updated = await ctx.store.updateAIAnalysis(analysis.id, {
        reviewerDisposition: input.disposition,
        reviewedBy: auth.user.id,
      });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "ai.reviewed",
        targetType: "AI_ANALYSIS",
        targetId: analysis.id,
        after: { disposition: input.disposition, kind: analysis.kind },
      });
      res.json(updated);
    }),
  );

  return router;
}

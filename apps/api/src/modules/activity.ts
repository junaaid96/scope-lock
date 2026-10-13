import { Router } from "express";
import { z } from "zod";
import { CreateDecisionNoteSchema, ListQuerySchema, UpdateDecisionNoteSchema } from "@scopelock/contracts";
import { DomainError, computeScopeHealth } from "@scopelock/domain";
import type { AppContext } from "../app-context.js";
import { asyncHandler } from "../http/errors.js";
import { authenticate, requireAuth } from "../http/auth.js";
import { requireAction, requireProjectAccess } from "../http/access.js";
import { validateBody, validateParams, validateQuery } from "../http/validate.js";
import { paginateList } from "../http/pagination.js";
import type { ApiRequest } from "../http/types.js";
import { audit } from "../lib/audit.js";
import { nowIso } from "../store/index.js";

const OPEN_STATUSES = ["DRAFT", "SUBMITTED", "TRIAGING", "NEEDS_CLARIFICATION", "ESTIMATING", "PENDING_APPROVAL"];

export function activityRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use(authenticate(ctx.store));

  router.get(
    "/projects/:id/activity",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateQuery(
      z.object({
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(25),
        targetType: z.string().optional(),
        targetId: z.string().optional(),
      }),
    ),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const q = (req as ApiRequest).validatedQuery as {
        cursor?: string;
        limit: number;
        targetType?: string;
        targetId?: string;
      };
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "activity.view");
      let result;
      try {
        result = await ctx.store.listAuditEvents({
          projectId: access.project.id,
          cursor: q.cursor,
          limit: q.limit,
          ...(q.targetType ? { targetType: q.targetType } : {}),
          ...(q.targetId ? { targetId: q.targetId } : {}),
        });
      } catch {
        throw DomainError.badRequest("Invalid pagination cursor");
      }
      res.json({
        data: result.items.map((e) => ({
          id: e.id,
          action: e.action,
          targetType: e.targetType,
          targetId: e.targetId,
          actorEmail: e.actorEmail,
          before: e.before,
          after: e.after,
          createdAt: e.createdAt,
        })),
        pagination: { nextCursor: result.nextCursor },
      });
    }),
  );

  // ----- Decision notes -----
  router.get(
    "/projects/:id/decision-notes",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateQuery(ListQuerySchema.merge(z.object({ targetType: z.string().optional(), targetId: z.string().optional() }).partial())),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const q = (req as ApiRequest).validatedQuery as { targetType?: string; targetId?: string; cursor?: string; limit: number };
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "activity.view");
      res.json(paginateList(await ctx.store.listDecisionNotes(access.project.id, q), q));
    }),
  );

  router.post(
    "/projects/:id/decision-notes",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(CreateDecisionNoteSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof CreateDecisionNoteSchema>;
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "note.create");
      // Target must exist inside this project (prevents dangling/cross-project refs).
      await assertNoteTarget(ctx, access.project.id, input.targetType, input.targetId);
      const note = await ctx.store.createDecisionNote({
        projectId: access.project.id,
        targetType: input.targetType,
        targetId: input.targetId,
        body: input.body,
        authorId: auth.user.id,
      });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "note.created",
        targetType: input.targetType,
        targetId: input.targetId,
        after: { noteId: note.id },
      });
      res.status(201).json(note);
    }),
  );

  router.patch(
    "/decision-notes/:id",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(UpdateDecisionNoteSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof UpdateDecisionNoteSchema>;
      const note = await ctx.store.findDecisionNoteById(req.params.id as string);
      if (!note) throw DomainError.notFound("Decision note not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, note.projectId);
      requireAction(access.access, "note.create");
      const isLead = access.projectMember?.role === "LEAD" || access.membership.role === "OWNER" || access.membership.role === "ADMIN";
      if (note.authorId !== auth.user.id && !isLead) {
        throw DomainError.forbidden("Only the author or a project lead can edit this note");
      }
      const updated = await ctx.store.updateDecisionNote(note.id, {
        body: input.body,
        editHistory: [...note.editHistory, { body: note.body, editedBy: auth.user.id, editedAt: nowIso() }],
      });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "note.edited",
        targetType: note.targetType,
        targetId: note.targetId,
        before: { noteId: note.id },
        after: { noteId: note.id, edits: updated.editHistory.length },
      });
      res.json(updated);
    }),
  );

  // ----- Decision search (P1): every hit links to its original context -----
  router.get(
    "/projects/:id/decisions",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateQuery(ListQuerySchema.merge(z.object({ q: z.string().max(200).optional() }).partial())),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const q = (req as ApiRequest).validatedQuery as { q?: string; cursor?: string; limit: number };
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "activity.view");
      const decisions = await ctx.store.listDecisionsWithContext(access.project.id, q.q);
      const approvals = await ctx.store.listProjectApprovals(access.project.id);
      const byId = new Map(approvals.map((a) => [a.id, a]));
      res.json(paginateList(decisions.map((d) => {
        const approval = byId.get(d.approvalRequestId);
        return {
          ...d,
          approvalTitle: approval?.title ?? null,
          changeRequestId: approval?.changeRequestId ?? null,
          bundleId: approval?.bundleId ?? null,
        };
      }), q));
    }),
  );

  // ----- Export (P1): portable change summary -----
  router.get(
    "/projects/:id/export/change/:changeId",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1), changeId: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "export.read");
      const change = await ctx.store.findChangeById(req.params.changeId as string);
      if (!change || change.projectId !== access.project.id) throw DomainError.notFound("Change not found");
      const [impact, links, clarifications, approvals, notes, attachments] = await Promise.all([
        ctx.store.findLatestImpact(change.id),
        ctx.store.listChangeLinks(change.id),
        ctx.store.listClarifications(change.id),
        ctx.store.listApprovalsForChange(change.id),
        ctx.store.listDecisionNotes(access.project.id, { targetType: "CHANGE", targetId: change.id }),
        ctx.store.listAttachments(access.project.id),
      ]);
      const decisions = (await Promise.all(approvals.map((a) => ctx.store.listDecisions(a.id)))).flat();
      const linkedRequirements = await Promise.all(
        links
          .filter((l) => l.targetType === "REQUIREMENT" && l.targetRequirementId)
          .map(async (l) => {
            const r = await ctx.store.findRequirementById(l.targetRequirementId as string);
            return r ? { requirementId: r.id, stableKey: r.stableKey, status: r.status, scopeVersionId: l.scopeVersionId } : null;
          }),
      );
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "change.exported",
        targetType: "CHANGE",
        targetId: change.id,
      });
      res.json({
        exportedAt: nowIso(),
        project: { id: access.project.id, name: access.project.name, currency: access.project.currency },
        change: { number: change.number, title: change.title, description: change.description, status: change.status, classification: change.classification, createdAt: change.createdAt, decidedAt: change.decidedAt },
        impact,
        linkedRequirements: linkedRequirements.filter(Boolean),
        clarifications,
        approvals: approvals.map((a) => ({
          id: a.id,
          title: a.title,
          status: a.status,
          checksum: a.checksum,
          sentAt: a.sentAt,
          expiresAt: a.expiresAt,
          decisions: decisions.filter((d) => d.approvalRequestId === a.id),
        })),
        notes,
        attachments: attachments
          .filter((a) => a.linkedType === "CHANGE" && a.linkedId === change.id)
          .map((a) => ({ fileName: a.fileName, contentType: a.contentType, sizeBytes: a.sizeBytes, checksum: a.checksum })),
      });
    }),
  );

  // ----- Metrics (plan §17) -----
  router.get(
    "/projects/:id/metrics",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "health.view");
      const [changes, approvals, versions, metrics, analyses] = await Promise.all([
        ctx.store.listChanges(access.project.id),
        ctx.store.listProjectApprovals(access.project.id),
        ctx.store.listProjectScopeVersions(access.project.id),
        ctx.store.listMetrics(access.project.id),
        ctx.store.listAIAnalyses(access.project.id),
      ]);
      const decided = changes.filter((c) => c.decidedAt);
      const latencies = decided
        .map((c) => (Date.parse(c.decidedAt as string) - Date.parse(c.createdAt)) / 3_600_000)
        .sort((a, b) => a - b);
      const median = latencies.length === 0 ? null : latencies[Math.floor(latencies.length / 2)];
      let linked = 0;
      for (const c of changes) {
        const links = await ctx.store.listChangeLinks(c.id);
        if (links.some((l) => l.targetType === "REQUIREMENT")) linked++;
      }
      const invalidated = approvals.filter((a) => a.status === "INVALIDATED").length;
      // "Decision without clarification": approved changes decided with zero Q&A rounds.
      const approvedChanges = changes.filter((c) => c.status === "APPROVED" || c.status === "IMPLEMENTED");
      let withoutClarification = 0;
      for (const c of approvedChanges) {
        const rounds = await ctx.store.listClarifications(c.id);
        if (rounds.length === 0) withoutClarification++;
      }
      const noClarificationRate = approvedChanges.length === 0 ? null : withoutClarification / approvedChanges.length;
      // AI usefulness: accepted (as-is or edited) out of reviewed suggestions.
      const reviewed = analyses.filter((a) => a.reviewerDisposition);
      const accepted = reviewed.filter((a) => a.reviewerDisposition === "ACCEPTED" || a.reviewerDisposition === "EDITED");
      res.json({
        baselinesPublished: versions.filter((v) => v.status !== "DRAFT").length,
        changeCompletionRate: changes.length === 0 ? null : decided.length / changes.length,
        medianSubmitToDecisionHours: median === null ? null : Math.round(median * 10) / 10,
        linkedToBaselineRate: changes.length === 0 ? null : linked / changes.length,
        approvalInvalidationRate: approvals.length === 0 ? null : invalidated / approvals.length,
        approvedWithoutClarificationRate: noClarificationRate === null ? null : Math.round(noClarificationRate * 1000) / 1000,
        aiSuggestionReview: {
          total: analyses.length,
          reviewed: reviewed.length,
          acceptRate: reviewed.length === 0 ? null : Math.round((accepted.length / reviewed.length) * 1000) / 1000,
        },
        eventCounts: metrics.reduce<Record<string, number>>((acc, m) => {
          acc[m.name] = (acc[m.name] ?? 0) + 1;
          return acc;
        }, {}),
      });
    }),
  );

  // ----- Scope health (P1) -----
  router.get(
    "/projects/:id/health",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "health.view");
      const [changes, approvals] = await Promise.all([
        ctx.store.listChanges(access.project.id),
        ctx.store.listProjectApprovals(access.project.id),
      ]);
      const unlinked: Array<{ id: string; title: string }> = [];
      for (const c of changes.filter((x) => OPEN_STATUSES.includes(x.status))) {
        const links = await ctx.store.listChangeLinks(c.id);
        if (!links.some((l) => l.targetType === "REQUIREMENT")) unlinked.push({ id: c.id, title: `${c.number}: ${c.title}` });
      }
      const health = computeScopeHealth({
        nowIso: nowIso(),
        openRequests: changes
          .filter((c) => OPEN_STATUSES.includes(c.status))
          .map((c) => ({ id: c.id, status: c.status, updatedAt: c.updatedAt, title: c.title })),
        pendingApprovals: approvals
          .filter((a) => a.status === "SENT")
          .map((a) => ({ id: a.id, expiresAt: a.expiresAt, changeTitle: a.title ?? "Review package" })),
        expiredApprovals: approvals
          .filter((a) => a.status === "EXPIRED")
          .map((a) => ({ id: a.id, changeTitle: a.title ?? "Review package" })),
        unlinkedRequests: unlinked,
        unapprovedImplementations: changes
          .filter((c) => c.status === "IMPLEMENTED" && !c.decidedAt)
          .map((c) => ({ id: c.id, title: `${c.number}: ${c.title}` })),
      });
      res.json(health);
    }),
  );

  return router;
}

async function assertNoteTarget(ctx: AppContext, projectId: string, targetType: string, targetId: string): Promise<void> {
  if (targetType === "PROJECT") {
    if (targetId !== projectId) throw DomainError.unprocessable("Project note must target this project");
    return;
  }
  if (targetType === "REQUIREMENT") {
    const r = await ctx.store.findRequirementById(targetId);
    if (!r || r.projectId !== projectId) throw DomainError.notFound("Requirement not found");
    return;
  }
  if (targetType === "CHANGE") {
    const c = await ctx.store.findChangeById(targetId);
    if (!c || c.projectId !== projectId) throw DomainError.notFound("Change not found");
    return;
  }
  if (targetType === "SCOPE_VERSION") {
    const v = await ctx.store.findScopeVersionById(targetId);
    if (!v || v.projectId !== projectId) throw DomainError.notFound("Scope version not found");
    return;
  }
  throw DomainError.unprocessable(`Unknown note target: ${targetType}`);
}

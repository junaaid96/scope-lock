import { Router } from "express";
import { z } from "zod";
import {
  AnswerClarificationSchema,
  CreateChangeLinkSchema,
  CreateChangeSchema,
  CreateClarificationSchema,
  ListQuerySchema,
  SubmitChangeSchema,
  UpdateChangeSchema,
  UpsertImpactSchema,
} from "@scopelock/contracts";
import {
  ApprovalTransitions,
  DomainError,
  assertManualChangeTransition,
  assertTransition,
} from "@scopelock/domain";
import type { AppContext } from "../app-context.js";
import { asyncHandler } from "../http/errors.js";
import { authenticate, requireAuth } from "../http/auth.js";
import { requireAction, requireProjectAccess } from "../http/access.js";
import { validateBody, validateParams, validateQuery } from "../http/validate.js";
import { paginateList } from "../http/pagination.js";
import type { ApiRequest } from "../http/types.js";
import { audit } from "../lib/audit.js";
import { getContext } from "../context.js";
import { notify, notifyProjectMembers } from "../lib/notify.js";
import type { ChangeRequest, Store } from "../store/index.js";
import { nowIso } from "../store/index.js";

const SENDABLE_FROM = ["ESTIMATING"] as const;

/** Unsatisfied DEPENDS_ON prerequisites (empty = clear). Re-checked at decision time. */
export async function getDependencyBlockers(store: Store, change: ChangeRequest): Promise<string[]> {
  const blockers: string[] = [];
  const links = await store.listChangeLinks(change.id);
  for (const link of links.filter((l) => l.kind === "DEPENDS_ON" && l.targetChangeId)) {
    if (link.overrideRationale) continue;
    const prereq = await store.findChangeById(link.targetChangeId as string);
    const need = link.condition === "PREREQ_IMPLEMENTED" ? "IMPLEMENTED" : "APPROVED";
    const satisfied =
      link.condition === "PREREQ_IMPLEMENTED"
        ? prereq?.status === "IMPLEMENTED"
        : prereq && (prereq.status === "APPROVED" || prereq.status === "IMPLEMENTED");
    if (!satisfied) {
      blockers.push(
        `Dependency not satisfied: ${prereq?.number ?? "prerequisite"} must be ${need} first (or record an override rationale).`,
      );
    }
  }
  return blockers;
}

/** Compute why a change cannot be sent for approval yet (empty = ready). */
export async function getSendBlockers(store: Store, change: ChangeRequest): Promise<string[]> {
  const blockers: string[] = [];
  if (!(SENDABLE_FROM as readonly string[]).includes(change.status)) {
    blockers.push(`Status must be ESTIMATING to send (currently ${change.status}). Move it through triage and estimation first.`);
  }
  const impact = await store.findLatestImpact(change.id);
  if (!impact) {
    blockers.push("An impact assessment is required before sending.");
  } else {
    if (impact.priceMinor === null || !impact.currency) blockers.push("Impact must include a price and currency (use 0 for no charge).");
    if (impact.effortDays === null) blockers.push("Impact must include an effort estimate.");
  }
  blockers.push(...(await getDependencyBlockers(store, change)));
  const approvals = await store.listApprovalsForChange(change.id);
  if (approvals.some((a) => a.status === "SENT")) {
    blockers.push("A review package is already awaiting decision. Invalidate it before sending a new one.");
  }
  return blockers;
}

/**
 * Material edits invalidate pending approvals: the client must always decide
 * on exactly what they reviewed. Old decisions stay visible as history.
 */
export async function invalidateApprovalsForChange(
  store: Store,
  args: { organizationId: string; projectId: string; actorId: string | null; actorEmail: string | null; changeId: string; bundleId?: string | null; reason: string; correlationId?: string },
): Promise<number> {
  const direct = await store.listApprovalsForChange(args.changeId);
  const viaBundle = args.bundleId ? await store.listApprovalsForBundle(args.bundleId) : [];
  const sent = [...direct, ...viaBundle].filter((a) => a.status === "SENT");
  // RULE7: trace the invalidation to the originating request, not a fresh id.
  const correlationId = args.correlationId ?? getContext()?.correlationId ?? `inv-${Date.now()}`;
  for (const approval of sent) {
    assertTransition(ApprovalTransitions, approval.status, "INVALIDATED", "approval");
    await store.updateApproval(approval.id, {
      status: "INVALIDATED",
      invalidatedReason: args.reason,
      version: approval.version + 1,
    });
    await store.appendAuditEvent({
      organizationId: args.organizationId,
      projectId: args.projectId,
      actorId: args.actorId,
      actorEmail: args.actorEmail,
      action: "approval.invalidated",
      targetType: "APPROVAL",
      targetId: approval.id,
      before: { status: "SENT" },
      after: { status: "INVALIDATED", reason: args.reason },
      correlationId,
      ip: getContext()?.ip ?? null,
    });
  }
  if (sent.length > 0) {
    // Step the workflow back so the team can revise and resend a fresh package.
    const change = await store.findChangeById(args.changeId);
    if (change && change.status === "PENDING_APPROVAL") {
      await store.updateChange(change.id, { status: "ESTIMATING", version: change.version + 1 });
    }
    if (args.bundleId) {
      const bundle = await store.findBundleById(args.bundleId);
      if (bundle && bundle.status === "PENDING_APPROVAL") {
        await store.updateBundle(bundle.id, { status: "DRAFT" });
      }
    }
  }
  if (sent.length > 0) {
    await notifyProjectMembers(store, {
      projectId: args.projectId,
      organizationId: args.organizationId,
      type: "APPROVAL_INVALIDATED",
      title: "A review package was invalidated",
      body: `${sent.length} pending approval(s) invalidated: ${args.reason}. Send a fresh package after review.`,
      link: `/projects/${args.projectId}/changes/${args.changeId}`,
    });
  }
  return sent.length;
}

export function changeRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use(authenticate(ctx.store));

  router.get(
    "/projects/:id/change-requests",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateQuery(ListQuerySchema.merge(z.object({ status: z.string().optional(), bundleId: z.string().nullable().optional() }).partial())),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "project.view");
      const q = (req as ApiRequest).validatedQuery as { status?: string; cursor?: string; limit: number };
      const statuses = q.status ? (q.status.split(",") as ChangeRequest["status"][]) : undefined;
      const changes = await ctx.store.listChanges(access.project.id, statuses ? { status: statuses } : undefined);
      const data = await Promise.all(
        changes.map(async (c) => {
          const [impact, links, approvals] = await Promise.all([
            ctx.store.findLatestImpact(c.id),
            ctx.store.listChangeLinks(c.id),
            ctx.store.listApprovalsForChange(c.id),
          ]);
          return {
            ...c,
            impact,
            linkCount: links.length,
            latestApproval: approvals[0] ?? null,
          };
        }),
      );
      res.json(paginateList(data, q));
    }),
  );

  router.post(
    "/projects/:id/change-requests",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(CreateChangeSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof CreateChangeSchema>;
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "change.submit");
      const change = await ctx.store.createChange({
        projectId: access.project.id,
        title: input.title,
        description: input.description,
        source: input.source,
        status: "DRAFT",
        classification: null,
        classificationRationale: null,
        submitterId: auth.user.id,
        bundleId: null,
        amendmentVersionId: null,
      });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "change.created",
        targetType: "CHANGE",
        targetId: change.id,
        after: { number: change.number, title: change.title, source: change.source },
      });
      await ctx.store.recordMetric({
        organizationId: access.org.id,
        projectId: access.project.id,
        name: "change.submitted",
        properties: { source: change.source },
        actorId: auth.user.id,
      });
      await notifyProjectMembers(ctx.store, {
        projectId: access.project.id,
        organizationId: access.org.id,
        excludeUserId: auth.user.id,
        type: "CHANGE_CREATED",
        title: `New change request ${change.number}`,
        body: change.title,
        link: `/projects/${access.project.id}/changes/${change.id}`,
      });
      res.status(201).json(change);
    }),
  );

  router.get(
    "/change-requests/:id",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const change = await ctx.store.findChangeById(req.params.id as string);
      if (!change) throw DomainError.notFound("Change request not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, change.projectId);
      requireAction(access.access, "project.view");
      const [impact, impacts, links, clarifications, approvals, versions, attachments, externalLinks, bundle] =
        await Promise.all([
          ctx.store.findLatestImpact(change.id),
          ctx.store.listImpacts(change.id),
          ctx.store.listChangeLinks(change.id),
          ctx.store.listClarifications(change.id),
          ctx.store.listApprovalsForChange(change.id),
          ctx.store.listProjectScopeVersions(change.projectId),
          ctx.store.listAttachments(change.projectId),
          ctx.store.listExternalLinks(change.projectId),
          change.bundleId ? ctx.store.findBundleById(change.bundleId) : Promise.resolve(null),
        ]);
      const governing =
        versions
          .filter((v) => v.status === "PUBLISHED")
          .sort((a, b) => b.sequence - a.sequence)[0] ?? null;
      const enrichedLinks = await Promise.all(
        links.map(async (l) => {
          if (l.targetType === "REQUIREMENT" && l.targetRequirementId) {
            const req = await ctx.store.findRequirementById(l.targetRequirementId);
            return { ...l, targetTitle: req ? `${req.stableKey}` : null };
          }
          if (l.targetType === "CHANGE" && l.targetChangeId) {
            const target = await ctx.store.findChangeById(l.targetChangeId);
            return { ...l, targetTitle: target ? `${target.number}: ${target.title}` : null, targetStatus: target?.status ?? null };
          }
          return { ...l, targetTitle: null };
        }),
      );
      const decisions = (await Promise.all(approvals.map((a) => ctx.store.listDecisions(a.id)))).flat();
      const sendBlockers = await getSendBlockers(ctx.store, change);
      res.json({
        ...change,
        impact,
        impacts,
        links: enrichedLinks,
        clarifications,
        approvals,
        decisions,
        bundle,
        governingVersion: governing ? { id: governing.id, sequence: governing.sequence } : null,
        attachments: attachments.filter((a) => a.linkedType === "CHANGE" && a.linkedId === change.id),
        externalLinks: externalLinks.filter((e) => e.changeRequestId === change.id),
        sendBlockers,
      });
    }),
  );

  router.patch(
    "/change-requests/:id",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(UpdateChangeSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof UpdateChangeSchema>;
      const change = await ctx.store.findChangeById(req.params.id as string);
      if (!change) throw DomainError.notFound("Change request not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, change.projectId);
      if (change.version !== input.expectedVersion) {
        throw DomainError.conflict("This request changed since you loaded it. Reload and retry.", {
          expected: input.expectedVersion,
          actual: change.version,
        });
      }
      const wantsStatus = input.status !== undefined && input.status !== change.status;
      const wantsClassification = input.classification !== undefined || input.classificationRationale !== undefined;
      const wantsContent = input.title !== undefined || input.description !== undefined;
      if (wantsStatus || wantsClassification) requireAction(access.access, "change.triage");
      if (wantsContent) {
        const isSubmitter = change.submitterId === auth.user.id;
        const canTriage = (() => {
          try {
            requireAction(access.access, "change.triage");
            return true;
          } catch {
            return false;
          }
        })();
        if (!isSubmitter && !canTriage) throw DomainError.forbidden("Only the submitter or a project lead can edit this request");
        if (isSubmitter && !canTriage && !["DRAFT", "SUBMITTED", "NEEDS_CLARIFICATION"].includes(change.status)) {
          throw DomainError.forbidden("The request can no longer be edited by the submitter at this stage");
        }
      }
      if (wantsStatus && input.status) assertManualChangeTransition(change.status, input.status);
      const before = { status: change.status, title: change.title, classification: change.classification };
      const updated = await ctx.store.transaction(async (tx) => {
        const next = await tx.updateChange(change.id, {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.classification !== undefined ? { classification: input.classification } : {}),
          ...(input.classificationRationale !== undefined ? { classificationRationale: input.classificationRationale } : {}),
          version: change.version + 1,
        });
        await invalidateApprovalsForChange(tx, {
          organizationId: access.org.id,
          projectId: access.project.id,
          actorId: auth.user.id,
          actorEmail: auth.user.email,
          changeId: change.id,
          bundleId: change.bundleId,
          reason: "The request was edited after the package was sent",
        });
        return next;
      });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "change.updated",
        targetType: "CHANGE",
        targetId: change.id,
        before,
        after: { status: updated.status, title: updated.title, classification: updated.classification },
      });
      res.json(updated);
    }),
  );

  router.post(
    "/change-requests/:id/submit",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(SubmitChangeSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof SubmitChangeSchema>;
      const change = await ctx.store.findChangeById(req.params.id as string);
      if (!change) throw DomainError.notFound("Change request not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, change.projectId);
      requireAction(access.access, "change.submit");
      if (change.version !== input.expectedVersion) throw DomainError.conflict("Stale request version. Reload and retry.");
      assertManualChangeTransition(change.status, "SUBMITTED");
      const updated = await ctx.store.updateChange(change.id, { status: "SUBMITTED", version: change.version + 1 });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "change.submitted",
        targetType: "CHANGE",
        targetId: change.id,
        before: { status: change.status },
        after: { status: "SUBMITTED" },
      });
      await notifyProjectMembers(ctx.store, {
        projectId: access.project.id,
        organizationId: access.org.id,
        excludeUserId: auth.user.id,
        type: "CHANGE_SUBMITTED",
        title: `${change.number} submitted for triage`,
        body: change.title,
        link: `/projects/${access.project.id}/changes/${change.id}`,
      });
      res.json(updated);
    }),
  );

  router.post(
    "/change-requests/:id/impact",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(UpsertImpactSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof UpsertImpactSchema>;
      const change = await ctx.store.findChangeById(req.params.id as string);
      if (!change) throw DomainError.notFound("Change request not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, change.projectId);
      requireAction(access.access, "change.estimate");
      if (input.expectedVersion !== undefined && change.version !== input.expectedVersion) {
        throw DomainError.conflict("Stale request version. Reload and retry.");
      }
      if (input.currency && input.currency !== access.project.currency) {
        throw DomainError.unprocessable(`Impact currency must match the project currency (${access.project.currency})`);
      }
      const result = await ctx.store.transaction(async (tx) => {
        const impact = await tx.createImpact({
          changeRequestId: change.id,
          effortDays: input.effortDays ?? null,
          priceMinor: input.priceMinor ?? null,
          currency: input.currency ?? access.project.currency,
          timelineDays: input.timelineDays ?? null,
          milestoneEffect: input.milestoneEffect ?? null,
          risks: input.risks,
          exclusions: input.exclusions,
          notes: input.notes ?? null,
          confidence: input.confidence,
          createdBy: auth.user.id,
        });
        await tx.updateChange(change.id, { version: change.version + 1 });
        await invalidateApprovalsForChange(tx, {
          organizationId: access.org.id,
          projectId: access.project.id,
          actorId: auth.user.id,
          actorEmail: auth.user.email,
          changeId: change.id,
          bundleId: change.bundleId,
          reason: "The impact assessment changed after the package was sent",
        });
        return impact;
      });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "change.impact_recorded",
        targetType: "CHANGE",
        targetId: change.id,
        after: { priceMinor: input.priceMinor ?? null, effortDays: input.effortDays ?? null, confidence: input.confidence },
      });
      res.status(201).json(result);
    }),
  );

  router.post(
    "/change-requests/:id/links",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(CreateChangeLinkSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof CreateChangeLinkSchema>;
      const change = await ctx.store.findChangeById(req.params.id as string);
      if (!change) throw DomainError.notFound("Change request not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, change.projectId);
      requireAction(access.access, "change.estimate");
      if (input.targetType === "REQUIREMENT") {
        if (!input.targetRequirementId) throw DomainError.unprocessable("targetRequirementId is required");
        const req = await ctx.store.findRequirementById(input.targetRequirementId);
        if (!req || req.projectId !== access.project.id) throw DomainError.notFound("Requirement not found");
        if (input.kind === "DEPENDS_ON") throw DomainError.unprocessable("DEPENDS_ON applies to change prerequisites, not requirements");
      } else {
        if (!input.targetChangeId) throw DomainError.unprocessable("targetChangeId is required");
        if (input.targetChangeId === change.id) throw DomainError.unprocessable("A request cannot link to itself");
        const target = await ctx.store.findChangeById(input.targetChangeId);
        if (!target || target.projectId !== access.project.id) throw DomainError.notFound("Target change not found");
        if (input.targetChangeId && target.bundleId && change.bundleId && target.bundleId === change.bundleId && input.kind === "DEPENDS_ON") {
          throw DomainError.unprocessable("Changes in the same bundle cannot depend on each other");
        }
        if (input.kind === "DEPENDS_ON" && !input.condition) {
          throw DomainError.unprocessable("A dependency link requires a condition (PREREQ_APPROVED or PREREQ_IMPLEMENTED)");
        }
      }
      if (input.overrideRationale) {
        // Overrides need an explicit authorized rationale from a project lead.
        const isLead = access.projectMember?.role === "LEAD" || access.membership.role === "OWNER" || access.membership.role === "ADMIN";
        if (!isLead) throw DomainError.forbidden("Only a project lead can record a dependency override");
      }
      const existing = await ctx.store.listChangeLinks(change.id);
      const duplicate = existing.some(
        (l) =>
          l.targetType === input.targetType &&
          l.targetRequirementId === (input.targetRequirementId ?? null) &&
          l.targetChangeId === (input.targetChangeId ?? null) &&
          l.kind === input.kind,
      );
      if (duplicate) throw DomainError.conflict("This link already exists");
      const link = await ctx.store.transaction(async (tx) => {
        const created = await tx.createChangeLink({
          changeRequestId: change.id,
          targetType: input.targetType,
          targetRequirementId: input.targetRequirementId ?? null,
          targetChangeId: input.targetChangeId ?? null,
          scopeVersionId: input.scopeVersionId ?? null,
          kind: input.kind,
          condition: input.condition ?? null,
          overrideRationale: input.overrideRationale ?? null,
          overrideBy: input.overrideRationale ? auth.user.id : null,
          createdBy: auth.user.id,
        });
        await tx.updateChange(change.id, { version: change.version + 1 });
        await invalidateApprovalsForChange(tx, {
          organizationId: access.org.id,
          projectId: access.project.id,
          actorId: auth.user.id,
          actorEmail: auth.user.email,
          changeId: change.id,
          bundleId: change.bundleId,
          reason: "Linked requirements changed after the package was sent",
        });
        return created;
      });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "change.link_added",
        targetType: "CHANGE",
        targetId: change.id,
        after: { kind: link.kind, targetType: link.targetType },
      });
      res.status(201).json(link);
    }),
  );

  router.delete(
    "/change-requests/:id/links/:linkId",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1), linkId: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const change = await ctx.store.findChangeById(req.params.id as string);
      if (!change) throw DomainError.notFound("Change request not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, change.projectId);
      requireAction(access.access, "change.estimate");
      const links = await ctx.store.listChangeLinks(change.id);
      const link = links.find((l) => l.id === (req.params.linkId as string));
      if (!link) throw DomainError.notFound("Link not found");
      await ctx.store.transaction(async (tx) => {
        await tx.deleteChangeLink(link.id);
        await tx.updateChange(change.id, { version: change.version + 1 });
        await invalidateApprovalsForChange(tx, {
          organizationId: access.org.id,
          projectId: access.project.id,
          actorId: auth.user.id,
          actorEmail: auth.user.email,
          changeId: change.id,
          bundleId: change.bundleId,
          reason: "Linked requirements changed after the package was sent",
        });
      });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "change.link_removed",
        targetType: "CHANGE",
        targetId: change.id,
        before: { linkId: link.id, kind: link.kind },
      });
      res.json({ ok: true });
    }),
  );

  router.post(
    "/change-requests/:id/clarifications",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(CreateClarificationSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof CreateClarificationSchema>;
      const change = await ctx.store.findChangeById(req.params.id as string);
      if (!change) throw DomainError.notFound("Change request not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, change.projectId);
      requireAction(access.access, "change.triage");
      const clarification = await ctx.store.createClarification({
        changeRequestId: change.id,
        question: input.question,
        askedBy: auth.user.id,
        askedAt: nowIso(),
      });
      const submitter = await ctx.store.findUserById(change.submitterId);
      if (submitter && submitter.id !== auth.user.id) {
        await notify(ctx.store, {
          userId: submitter.id,
          projectId: access.project.id,
          organizationId: access.org.id,
          type: "CLARIFICATION_REQUESTED",
          title: `Clarification needed on ${change.number}`,
          body: input.question,
          link: `/projects/${access.project.id}/changes/${change.id}`,
          email: { to: submitter.email, subject: `Clarification needed on ${change.number}`, text: input.question },
        });
      }
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "change.clarification_asked",
        targetType: "CHANGE",
        targetId: change.id,
        after: { question: input.question.slice(0, 280) },
      });
      res.status(201).json(clarification);
    }),
  );

  router.post(
    "/change-requests/:id/clarifications/:clarId/answer",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1), clarId: z.string().min(1) })),
    validateBody(AnswerClarificationSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof AnswerClarificationSchema>;
      const change = await ctx.store.findChangeById(req.params.id as string);
      if (!change) throw DomainError.notFound("Change request not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, change.projectId);
      requireAction(access.access, "project.view");
      if (access.projectMember?.role === "CLIENT_VIEWER") {
        throw DomainError.forbidden("Viewers cannot answer clarifications");
      }
      const clarifications = await ctx.store.listClarifications(change.id);
      const found = clarifications.find((c) => c.id === (req.params.clarId as string));
      if (!found) throw DomainError.notFound("Clarification not found");
      if (found.answer) throw DomainError.conflict("This question was already answered");
      const updated = await ctx.store.answerClarification(found.id, input.answer, auth.user.id, nowIso());
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "change.clarification_answered",
        targetType: "CHANGE",
        targetId: change.id,
        after: { clarificationId: found.id },
      });
      res.json(updated);
    }),
  );

  return router;
}

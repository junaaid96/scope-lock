import { Router } from "express";
import { z } from "zod";
import { DecideApprovalSchema, ListQuerySchema, SendApprovalSchema } from "@scopelock/contracts";
import {
  ApprovalTransitions,
  BundleTransitions,
  ChangeTransitions,
  DomainError,
  assertTransition,
  checksumOf,
  drawAmountFor,
  drawBlocker,
  newToken,
  objectionDeadline,
  sha256Hex,
} from "@scopelock/domain";
import type { AppContext } from "../app-context.js";
import { asyncHandler } from "../http/errors.js";
import { authenticate, requireAuth } from "../http/auth.js";
import { requireAction, requireProjectAccess } from "../http/access.js";
import { idempotency } from "../http/idempotency.js";
import { rateLimit } from "../http/rate-limit.js";
import { validateBody, validateParams, validateQuery } from "../http/validate.js";
import { paginateList } from "../http/pagination.js";
import type { ApiRequest } from "../http/types.js";
import { getContext } from "../context.js";
import { audit } from "../lib/audit.js";
import { notify } from "../lib/notify.js";
import type {
  ApprovalRequest,
  Bundle,
  ChangeRequest,
  ReviewPackageSnapshot,
  Store,
} from "../store/index.js";
import { nowIso } from "../store/index.js";
import { getDependencyBlockers, getSendBlockers } from "./changes.js";
import { combineBundleImpact, getBundleSendBlockers } from "./lifecycle.js";
import { getGoverningVersion } from "./scope.js";

async function requirementEntries(
  store: Store,
  projectId: string,
  requirementIds: string[],
): Promise<ReviewPackageSnapshot["requirements"]> {
  const governing = await getGoverningVersion(store, projectId);
  const govRevs = governing ? await store.listRevisionsByVersion(governing.id) : [];
  const govByReq = new Map(govRevs.map((r) => [r.requirementId, r]));
  const versions = await store.listProjectScopeVersions(projectId);
  const draft = versions.find((v) => v.status === "DRAFT") ?? null;
  const draftRevs = draft ? await store.listRevisionsByVersion(draft.id) : [];
  const draftByReq = new Map(draftRevs.map((r) => [r.requirementId, r]));
  const entries: ReviewPackageSnapshot["requirements"] = [];
  for (const reqId of [...new Set(requirementIds)]) {
    const req = await store.findRequirementById(reqId);
    if (!req) continue;
    const rev = govByReq.get(reqId) ?? draftByReq.get(reqId) ?? null;
    entries.push({
      requirementId: req.id,
      stableKey: req.stableKey,
      title: rev?.title ?? "(no content in scope yet)",
      description: rev?.description ?? "",
      acceptanceCriteria: rev?.acceptanceCriteria ?? [],
      scopeVersionId: rev?.scopeVersionId ?? "",
      versionSequence: rev ? (rev.scopeVersionId === governing?.id ? (governing?.sequence ?? 0) : (draft?.sequence ?? 0)) : 0,
    });
  }
  return entries;
}

async function buildChangePackage(store: Store, change: ChangeRequest): Promise<ReviewPackageSnapshot> {
  const impact = await store.findLatestImpact(change.id);
  const links = await store.listChangeLinks(change.id);
  const reqIds = links.filter((l) => l.targetType === "REQUIREMENT" && l.targetRequirementId).map((l) => l.targetRequirementId as string);
  const governing = await getGoverningVersion(store, change.projectId);
  const attachments = (await store.listAttachments(change.projectId)).filter(
    (a) => a.linkedType === "CHANGE" && a.linkedId === change.id && a.status === "READY",
  );
  return {
    title: null,
    changeId: change.id,
    bundleId: null,
    request: {
      number: change.number,
      title: change.title,
      description: change.description,
      source: change.source,
      classification: change.classification,
    },
    members: [],
    impact: impact
      ? {
          effortDays: impact.effortDays,
          priceMinor: impact.priceMinor,
          currency: impact.currency,
          timelineDays: impact.timelineDays,
          milestoneEffect: impact.milestoneEffect,
          risks: impact.risks,
          exclusions: impact.exclusions,
          notes: impact.notes,
          confidence: impact.confidence,
        }
      : null,
    requirements: await requirementEntries(store, change.projectId, reqIds),
    attachments: attachments.map((a) => ({
      attachmentId: a.id,
      fileName: a.fileName,
      contentType: a.contentType,
      sizeBytes: a.sizeBytes,
      checksum: a.checksum,
    })),
    assumptions: governing?.assumptions ?? [],
    exclusions: governing?.exclusions ?? [],
    sentAt: nowIso(),
  };
}

async function buildBundlePackage(store: Store, bundle: Bundle): Promise<ReviewPackageSnapshot> {
  const members = await store.listChanges(bundle.projectId, { bundleId: bundle.id });
  const combined = await combineBundleImpact(store, bundle);
  const reqIds: string[] = [];
  for (const m of members) {
    const links = await store.listChangeLinks(m.id);
    for (const l of links) if (l.targetType === "REQUIREMENT" && l.targetRequirementId) reqIds.push(l.targetRequirementId);
  }
  const governing = await getGoverningVersion(store, bundle.projectId);
  const attachments = (await store.listAttachments(bundle.projectId)).filter(
    (a) => a.linkedType === "CHANGE" && members.some((m) => m.id === a.linkedId) && a.status === "READY",
  );
  return {
    title: null,
    changeId: null,
    bundleId: bundle.id,
    request: null,
    members: members.map((m) => ({ changeId: m.id, number: m.number, title: m.title, description: m.description })),
    impact: {
      effortDays: combined.effortDays,
      priceMinor: combined.priceMinor,
      currency: combined.currency,
      timelineDays: combined.timelineDays,
      milestoneEffect: null,
      risks: combined.risks,
      exclusions: combined.exclusions,
      notes: bundle.adjustmentNote ? `Bundle adjustment: ${bundle.adjustmentNote}` : null,
      confidence: "MEDIUM",
    },
    requirements: await requirementEntries(store, bundle.projectId, reqIds),
    attachments: attachments.map((a) => ({
      attachmentId: a.id,
      fileName: a.fileName,
      contentType: a.contentType,
      sizeBytes: a.sizeBytes,
      checksum: a.checksum,
    })),
    assumptions: governing?.assumptions ?? [],
    exclusions: governing?.exclusions ?? [],
    sentAt: nowIso(),
  };
}

export async function resolveApprovers(
  store: Store,
  projectId: string,
  userIds: string[],
  emails: string[],
): Promise<Array<{ userId: string | null; email: string }>> {
  const out: Array<{ userId: string | null; email: string }> = [];
  const seen = new Set<string>();
  for (const userId of [...new Set(userIds)]) {
    const member = await store.findProjectMember(projectId, userId);
    if (!member) throw DomainError.unprocessable(`Approver is not a project member: ${userId}`);
    if (member.role === "CLIENT_VIEWER") throw DomainError.unprocessable("Viewers cannot be approvers");
    const user = await store.findUserById(userId);
    if (!user) throw DomainError.unprocessable(`Approver not found: ${userId}`);
    const key = user.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ userId: user.id, email: user.email });
  }
  for (const email of emails) {
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const existing = await store.findUserByEmail(email);
    out.push({ userId: existing?.id ?? null, email });
  }
  if (out.length === 0) throw DomainError.unprocessable("At least one approver is required");
  return out;
}

export function approvalRoutes(ctx: AppContext): Router {
  const router = Router();

  // ----- Authenticated: send + manage -----
  const authed = Router();
  authed.use(authenticate(ctx.store));

  async function sendForChange(changeId: string, auth: { user: { id: string; email: string } }, input: z.infer<typeof SendApprovalSchema>): Promise<{ approval: ApprovalRequest; reviewTokens: string[] }> {
    const change = await ctx.store.findChangeById(changeId);
    if (!change) throw DomainError.notFound("Change request not found");
    const access = await requireProjectAccess(ctx.store, auth.user.id, change.projectId);
    requireAction(access.access, "change.send");
    const blockers = await getSendBlockers(ctx.store, change);
    if (blockers.length > 0) {
      throw DomainError.unprocessable("This proposal is not ready to send", { blockers });
    }
    if (Date.parse(input.expiresAt) <= Date.now()) throw DomainError.unprocessable("Expiry must be in the future");
    // Optional allowance draw-source: validated now, coverage re-checked at decision time.
    let drawPoolId: string | null | undefined;
    if ("allowancePoolId" in input) {
      drawPoolId = input.allowancePoolId ?? null;
      if (drawPoolId) {
        const pool = await ctx.store.findAllowancePoolById(drawPoolId);
        if (!pool || pool.projectId !== change.projectId) throw DomainError.notFound("Allowance pool not found");
        if (!pool.enabled || pool.status !== "ACTIVE") throw DomainError.unprocessable("Allowance pool is not active");
        const impact = await ctx.store.findLatestImpact(change.id);
        const draw = drawAmountFor({ kind: pool.kind, priceMinor: impact?.priceMinor ?? null, effortDays: impact?.effortDays ?? null });
        const blocker = drawBlocker({
          kind: pool.kind,
          totalHours: pool.totalHours,
          totalMinor: pool.totalMinor,
          drawDowns: await ctx.store.listDrawDownsByPool(pool.id),
          draw,
        });
        if (blocker) throw DomainError.unprocessable(blocker);
      }
    }
    const approvers = await resolveApprovers(ctx.store, change.projectId, input.approverUserIds, input.approverEmails);
    const pkg = await buildChangePackage(ctx.store, change);
    pkg.title = input.title ?? `${change.number}: ${change.title}`;
    const checksum = checksumOf(pkg);
    const tokens = approvers.map(() => newToken());
    const approval = await ctx.store.transaction(async (tx) => {
      const created = await tx.createApproval({
        projectId: change.projectId,
        changeRequestId: change.id,
        bundleId: null,
        allowancePoolId: null,
        title: pkg.title,
        package: pkg,
        checksum,
        status: "SENT",
        approverUserIds: approvers.filter((a) => a.userId).map((a) => a.userId as string),
        expiresAt: input.expiresAt,
        sentAt: nowIso(),
        sentBy: auth.user.id,
        createdBy: auth.user.id,
        invalidatedReason: null,
        supersededBy: null,
        remindersSent: [],
        version: 0,
      });
      for (let i = 0; i < approvers.length; i++) {
        const approver = approvers[i];
        if (!approver) continue;
        await tx.createApprovalToken({
          approvalRequestId: created.id,
          tokenHash: sha256Hex(tokens[i] as string),
          approverEmail: approver.email,
          approverUserId: approver.userId,
          expiresAt: input.expiresAt,
        });
      }
      assertTransition(ChangeTransitions, change.status, "PENDING_APPROVAL", "change");
      await tx.updateChange(change.id, {
        status: "PENDING_APPROVAL",
        version: change.version + 1,
        ...(drawPoolId !== undefined ? { drawAllowancePoolId: drawPoolId } : {}),
      });
      for (const old of await tx.listApprovalsForChange(change.id)) {
        if (old.id !== created.id && (old.status === "INVALIDATED" || old.status === "EXPIRED") && !old.supersededBy) {
          await tx.updateApproval(old.id, { supersededBy: created.id });
        }
      }
      return created;
    });
    await audit(ctx.store, {
      organizationId: access.org.id,
      projectId: access.project.id,
      actorId: auth.user.id,
      actorEmail: auth.user.email,
      action: "approval.sent",
      targetType: "APPROVAL",
      targetId: approval.id,
      after: { changeId: change.id, checksum, approvers: approvers.map((a) => a.email) },
    });
    await ctx.store.recordMetric({
      organizationId: access.org.id,
      projectId: access.project.id,
      name: "approval.sent",
      properties: { changeNumber: change.number },
      actorId: auth.user.id,
    });
    await notifyApprovalRequested(ctx, {
      orgId: access.org.id,
      projectId: access.project.id,
      approvalId: approval.id,
      title: pkg.title,
      expiresAt: input.expiresAt,
      approvers,
    });
    return { approval, reviewTokens: tokens };
  }

  authed.post(
    "/change-requests/:id/approval-requests",
    requireAuth,
    idempotency(ctx.store, "approval-send"),
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(SendApprovalSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof SendApprovalSchema>;
      const { approval, reviewTokens } = await sendForChange(req.params.id as string, auth, input);
      res.status(201).json({
        approval,
        ...(ctx.env.NODE_ENV !== "production"
          ? { reviewUrls: reviewTokens.map((t) => `${ctx.env.WEB_URL}/review/${t}`) }
          : {}),
      });
    }),
  );

  authed.post(
    "/bundles/:id/approval-requests",
    requireAuth,
    idempotency(ctx.store, "approval-send-bundle"),
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(SendApprovalSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof SendApprovalSchema>;
      const bundle = await ctx.store.findBundleById(req.params.id as string);
      if (!bundle) throw DomainError.notFound("Bundle not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, bundle.projectId);
      requireAction(access.access, "change.send");
      const blockers = await getBundleSendBlockers(ctx.store, bundle);
      if (blockers.length > 0) throw DomainError.unprocessable("This bundle is not ready to send", { blockers });
      if (Date.parse(input.expiresAt) <= Date.now()) throw DomainError.unprocessable("Expiry must be in the future");
      const approvers = await resolveApprovers(ctx.store, bundle.projectId, input.approverUserIds, input.approverEmails);
      const pkg = await buildBundlePackage(ctx.store, bundle);
      pkg.title = input.title ?? `Bundle: ${bundle.name}`;
      const checksum = checksumOf(pkg);
      const tokens = approvers.map(() => newToken());
      const approval = await ctx.store.transaction(async (tx) => {
        const created = await tx.createApproval({
          projectId: bundle.projectId,
          changeRequestId: null,
          bundleId: bundle.id,
          allowancePoolId: null,
          title: pkg.title,
          package: pkg,
          checksum,
          status: "SENT",
          approverUserIds: approvers.filter((a) => a.userId).map((a) => a.userId as string),
          expiresAt: input.expiresAt,
          sentAt: nowIso(),
          sentBy: auth.user.id,
          createdBy: auth.user.id,
          invalidatedReason: null,
          supersededBy: null,
          remindersSent: [],
          version: 0,
        });
        for (let i = 0; i < approvers.length; i++) {
          const approver = approvers[i];
          if (!approver) continue;
          await tx.createApprovalToken({
            approvalRequestId: created.id,
            tokenHash: sha256Hex(tokens[i] as string),
            approverEmail: approver.email,
            approverUserId: approver.userId,
            expiresAt: input.expiresAt,
          });
        }
        assertTransition(BundleTransitions, bundle.status, "PENDING_APPROVAL", "bundle");
        await tx.updateBundle(bundle.id, { status: "PENDING_APPROVAL" });
        for (const member of await tx.listChanges(bundle.projectId, { bundleId: bundle.id })) {
          assertTransition(ChangeTransitions, member.status, "PENDING_APPROVAL", "change");
          await tx.updateChange(member.id, { status: "PENDING_APPROVAL", version: member.version + 1 });
        }
        return created;
      });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "approval.sent",
        targetType: "APPROVAL",
        targetId: approval.id,
        after: { bundleId: bundle.id, checksum },
      });
      res.status(201).json({
        approval,
        ...(ctx.env.NODE_ENV !== "production"
          ? { reviewUrls: tokens.map((t: string) => `${ctx.env.WEB_URL}/review/${t}`) }
          : {}),
      });
    }),
  );

  authed.get(
    "/projects/:id/approval-requests",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateQuery(ListQuerySchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const q = (req as ApiRequest).validatedQuery as { cursor?: string; limit: number };
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "approval.view");
      const approvals = await ctx.store.listProjectApprovals(access.project.id);
      const decisions = (await Promise.all(approvals.map((a) => ctx.store.listDecisions(a.id)))).flat();
      const byApproval = new Map<string, typeof decisions>();
      for (const d of decisions) {
        const list = byApproval.get(d.approvalRequestId) ?? [];
        list.push(d);
        byApproval.set(d.approvalRequestId, list);
      }
      res.json(paginateList(approvals.map((a) => ({ ...a, decisions: byApproval.get(a.id) ?? [] })), q));
    }),
  );

  authed.post(
    "/approval-requests/:id/revoke",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(z.object({ reason: z.string().min(1).max(1000) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as { reason: string };
      const approval = await ctx.store.findApprovalById(req.params.id as string);
      if (!approval) throw DomainError.notFound("Approval not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, approval.projectId);
      requireAction(access.access, "change.send");
      if (approval.status !== "SENT") throw DomainError.conflict(`Only SENT approvals can be revoked (currently ${approval.status})`);
      await ctx.store.transaction(async (tx) => {
        assertTransition(ApprovalTransitions, approval.status, "INVALIDATED", "approval");
        await tx.updateApproval(approval.id, { status: "INVALIDATED", invalidatedReason: input.reason, version: approval.version + 1 });
        for (const token of await tx.listApprovalTokens(approval.id)) {
          if (!token.revokedAt) await tx.updateApprovalToken(token.id, { revokedAt: nowIso() });
        }
        if (approval.changeRequestId) {
          const change = await tx.findChangeById(approval.changeRequestId);
          if (change && change.status === "PENDING_APPROVAL") {
            await tx.updateChange(change.id, { status: "ESTIMATING", version: change.version + 1 });
          }
        }
        if (approval.bundleId) {
          const bundle = await tx.findBundleById(approval.bundleId);
          if (bundle && bundle.status === "PENDING_APPROVAL") await tx.updateBundle(bundle.id, { status: "DRAFT" });
          for (const member of await tx.listChanges(approval.projectId, { bundleId: approval.bundleId })) {
            if (member.status === "PENDING_APPROVAL") {
              await tx.updateChange(member.id, { status: "ESTIMATING", version: member.version + 1 });
            }
          }
        }
      });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "approval.revoked",
        targetType: "APPROVAL",
        targetId: approval.id,
        before: { status: "SENT" },
        after: { status: "INVALIDATED", reason: input.reason },
      });
      res.json({ ok: true });
    }),
  );

  authed.get(
    "/inbox",
    requireAuth,
    validateQuery(ListQuerySchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const q = (req as ApiRequest).validatedQuery as { cursor?: string; limit: number };
      const approvals = await ctx.store.listInboxApprovals(auth.user.id, auth.user.email);
      const data = await Promise.all(
        approvals.map(async (a) => {
          const project = await ctx.store.findProjectById(a.projectId);
          return { ...a, projectName: project?.name ?? null };
        }),
      );
      res.json(paginateList(data, q));
    }),
  );

  // ----- Unified review routes: approval-id (authenticated) or review-token (public) -----
  // One handler serves both shapes so the plan's /approval-requests/:token paths work
  // publicly while authenticated users can open the same package by approval id.
  const unified = Router();
  unified.use(authenticate(ctx.store));

  unified.get(
    "/approval-requests/:ref",
    rateLimit(ctx.env, "token"),
    validateParams(z.object({ ref: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      const ref = req.params.ref as string;
      if (auth) {
        const byId = await ctx.store.findApprovalById(ref);
        if (byId) {
          const access = await requireProjectAccess(ctx.store, auth.user.id, byId.projectId);
          requireAction(access.access, "approval.view");
          const [decisions, tokens] = await Promise.all([
            ctx.store.listDecisions(byId.id),
            ctx.store.listApprovalTokens(byId.id),
          ]);
          res.json({
            ...byId,
            decisions,
            tokens: tokens.map((t) => ({
              id: t.id,
              approverEmail: t.approverEmail,
              approverUserId: t.approverUserId,
              expiresAt: t.expiresAt,
              revokedAt: t.revokedAt,
              lastUsedAt: t.lastUsedAt,
            })),
          });
          return;
        }
      }
      const { approval, token } = await loadTokenPackage(ctx, ref);
      const project = await ctx.store.findProjectById(approval.projectId);
      if (!project) throw DomainError.notFound("Review package not found");
      const org = await ctx.store.findOrganizationById(project.organizationId);
      const decisions = await ctx.store.listDecisions(approval.id);
      const ctxInfo = getContext();
      await ctx.store.updateApprovalToken(token.id, { lastUsedAt: nowIso() });
      await ctx.store.appendAuditEvent({
        organizationId: project.organizationId,
        projectId: project.id,
        actorId: token.approverUserId,
        actorEmail: token.approverEmail,
        action: "approval.viewed",
        targetType: "APPROVAL",
        targetId: approval.id,
        after: { tokenId: token.id },
        correlationId: ctxInfo?.correlationId ?? "no-correlation",
        ip: ctxInfo?.ip ?? req.ip ?? null,
      });
      res.json({
        status: approval.status,
        title: approval.title,
        package: approval.package,
        checksum: approval.checksum,
        expiresAt: approval.expiresAt,
        decisions: decisions.map((d) => ({
          decision: d.decision,
          comment: d.comment,
          approverEmail: d.approverEmail,
          createdAt: d.createdAt,
        })),
        invalidatedReason: approval.invalidatedReason,
        branding: org?.branding ?? null,
        organizationName: org?.name ?? "ScopeLock",
        projectName: project.name,
      });
    }),
  );

  unified.post(
    "/approval-requests/:ref/decisions",
    rateLimit(ctx.env, "token"),
    idempotency(ctx.store, "approval-decide"),
    validateParams(z.object({ ref: z.string().min(1) })),
    validateBody(DecideApprovalSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      const input = req.body as z.infer<typeof DecideApprovalSchema>;
      const ref = req.params.ref as string;
      if (auth) {
        const byId = await ctx.store.findApprovalById(ref);
        if (byId) {
          const access = await requireProjectAccess(ctx.store, auth.user.id, byId.projectId);
          const isAssigned = byId.approverUserIds.includes(auth.user.id);
          requireAction({ ...access.access, isAssignedApprover: isAssigned }, "approval.decide");
          const decision = await recordDecision(ctx, byId, {
            approverUserId: auth.user.id,
            approverEmail: auth.user.email,
            tokenId: null,
            input,
            req: req as ApiRequest,
          });
          res.status(201).json(decision);
          return;
        }
      }
      const { approval, token } = await loadTokenPackage(ctx, ref);
      if (approval.status !== "SENT") {
        throw DomainError.conflict(`This package is ${approval.status} and can no longer be decided`, {
          status: approval.status,
        });
      }
      if (approval.expiresAt && approval.expiresAt <= nowIso()) {
        throw DomainError.gone("This review package has expired");
      }
      const decision = await recordDecision(ctx, approval, {
        approverUserId: token.approverUserId,
        approverEmail: token.approverEmail ?? "unknown",
        tokenId: token.id,
        input,
        req: req as ApiRequest,
      });
      res.status(201).json(decision);
    }),
  );

  // Public review routes first: the authed router's global guard must not see them.
  router.use(unified, authed);
  return router;
}

async function loadTokenPackage(ctx: AppContext, rawToken: string): Promise<{ approval: ApprovalRequest; token: { id: string; approvalRequestId: string; approverUserId: string | null; approverEmail: string | null } }> {
  const token = await ctx.store.findApprovalTokenByHash(sha256Hex(rawToken));
  if (!token || token.revokedAt) throw DomainError.notFound("Review package not found");
  if (token.expiresAt <= nowIso()) throw DomainError.gone("This review link has expired");
  const approval = await ctx.store.findApprovalById(token.approvalRequestId);
  if (!approval) throw DomainError.notFound("Review package not found");
  return { approval, token };
}

interface DecideInput {
  approverUserId: string | null;
  approverEmail: string;
  tokenId: string | null;
  input: z.infer<typeof DecideApprovalSchema>;
  req: ApiRequest;
}

/** Shared decision core: immutable decision bound to the reviewed checksum. */
/** Approval-requested fan-out, shared by change, bundle, and allowance sends. */
export async function notifyApprovalRequested(
  ctx: AppContext,
  args: {
    orgId: string;
    projectId: string;
    approvalId: string;
    title: string;
    expiresAt: string;
    approvers: Array<{ userId: string | null; email: string }>;
  },
): Promise<void> {
  for (const approver of args.approvers) {
    const body = `“${args.title}” needs your decision by ${args.expiresAt}. Open your inbox to review the exact package.`;
    if (approver.userId) {
      await notify(ctx.store, {
        userId: approver.userId,
        projectId: args.projectId,
        organizationId: args.orgId,
        type: "APPROVAL_REQUESTED",
        title: `Decision needed: ${args.title}`,
        body,
        link: "/inbox",
        email: { to: approver.email, subject: `Decision needed: ${args.title}`, text: `${body}\n\nReview: ${ctx.env.WEB_URL}/inbox` },
      });
    } else {
      await ctx.store.enqueueOutbox({
        type: "EMAIL",
        payload: {
          to: approver.email,
          subject: `Decision needed: ${args.title}`,
          text: `${body}\n\nReview: ${ctx.env.WEB_URL}/inbox`,
          organizationId: args.orgId,
          projectId: args.projectId,
          notificationType: "APPROVAL_REQUESTED",
        },
        idempotencyKey: `send:${args.approvalId}:${approver.email}`,
      });
    }
  }
}

async function recordDecision(ctx: AppContext, approval: ApprovalRequest, args: DecideInput): Promise<unknown> {
  if (approval.status !== "SENT") {
    throw DomainError.conflict(`This package is ${approval.status}; first decision already recorded`, {
      status: approval.status,
    });
  }
  if (approval.expiresAt && approval.expiresAt <= nowIso()) {
    throw DomainError.gone("This review package has expired");
  }
  if (args.input.decision !== "APPROVED" && !args.input.comment?.trim()) {
    throw DomainError.unprocessable("A comment is required when rejecting or requesting changes");
  }
  const ctxInfo = getContext();
  const project = await ctx.store.findProjectById(approval.projectId);
  if (!project) throw DomainError.notFound("Project not found");

  const decision = await ctx.store.transaction(async (tx) => {
    const fresh = await tx.findApprovalById(approval.id);
    if (!fresh || fresh.status !== "SENT") {
      throw DomainError.conflict("This package was just decided or withdrawn. Refresh to see its status.");
    }
    // Bind the decision to the exact reviewed bytes.
    if (checksumOf(fresh.package) !== fresh.checksum) {
      throw DomainError.conflict("This package changed after it was sent and must be re-sent before deciding");
    }
    const created = await tx.createDecision({
      approvalRequestId: fresh.id,
      approverUserId: args.approverUserId,
      approverEmail: args.approverEmail,
      tokenId: args.tokenId,
      decision: args.input.decision,
      comment: args.input.comment?.trim() || null,
      checksum: fresh.checksum,
      ip: ctxInfo?.ip ?? args.req.ip ?? null,
      userAgent: args.req.headers["user-agent"]?.slice(0, 300) ?? null,
    });
    assertTransition(ApprovalTransitions, fresh.status, "DECIDED", "approval");
    await tx.updateApproval(fresh.id, { status: "DECIDED", version: fresh.version + 1 });
    const now = nowIso();
    const targetChanges: ChangeRequest[] = [];
    if (fresh.changeRequestId) {
      const change = await tx.findChangeById(fresh.changeRequestId);
      if (change) targetChanges.push(change);
    }
    if (fresh.bundleId) {
      const bundle = await tx.findBundleById(fresh.bundleId);
      const members = await tx.listChanges(fresh.projectId, { bundleId: fresh.bundleId });
      targetChanges.push(...members);
      if (bundle) {
        if (args.input.decision === "APPROVED") {
          assertTransition(BundleTransitions, bundle.status, "APPROVED", "bundle");
          await tx.updateBundle(bundle.id, { status: "APPROVED" });
        } else if (args.input.decision === "REJECTED") {
          assertTransition(BundleTransitions, bundle.status, "REJECTED", "bundle");
          await tx.updateBundle(bundle.id, { status: "REJECTED" });
        } else {
          await tx.updateBundle(bundle.id, { status: "DRAFT" });
        }
      }
    }
    // A blocked request cannot be marked approved: re-verify DEPENDS_ON
    // prerequisites at decision time (they may have regressed since send).
    if (args.input.decision === "APPROVED") {
      for (const change of targetChanges) {
        const depBlockers = await getDependencyBlockers(tx, change);
        if (depBlockers.length > 0) {
          throw DomainError.conflict(`Cannot approve ${change.number}: ${depBlockers.join(" ")}`, {
            changeId: change.id,
            blockers: depBlockers,
          });
        }
      }
    }
    const nextStatus = args.input.decision === "APPROVED" ? "APPROVED" : args.input.decision === "REJECTED" ? "REJECTED" : "NEEDS_CLARIFICATION";
    for (const change of targetChanges) {
      assertTransition(ChangeTransitions, change.status, nextStatus, "change");
      await tx.updateChange(change.id, {
        status: nextStatus,
        decidedAt: nextStatus === "NEEDS_CLARIFICATION" ? change.decidedAt : now,
        version: change.version + 1,
      });
      await tx.recordMetric({
        organizationId: project.organizationId,
        projectId: project.id,
        name: "change.decided",
        properties: { number: change.number, decision: args.input.decision },
        actorId: args.approverUserId,
      });
    }
    await tx.appendAuditEvent({
      organizationId: project.organizationId,
      projectId: project.id,
      actorId: args.approverUserId,
      actorEmail: args.approverEmail,
      action: "approval.decided",
      targetType: "APPROVAL",
      targetId: fresh.id,
      before: { status: "SENT" },
      after: { status: "DECIDED", decision: args.input.decision, checksum: fresh.checksum },
      correlationId: ctxInfo?.correlationId ?? "no-correlation",
      ip: ctxInfo?.ip ?? args.req.ip ?? null,
    });
    // Allowance grant decisions activate the pool itself — the grant IS the
    // client-approved decision, so draw-downs never become auto-approval.
    if (fresh.allowancePoolId) {
      const pool = await tx.findAllowancePoolById(fresh.allowancePoolId);
      if (!pool || pool.projectId !== approval.projectId) throw DomainError.notFound("Allowance pool not found");
      if (args.input.decision === "APPROVED") {
        if (pool.status !== "PROPOSED") throw DomainError.conflict("This allowance pool is no longer awaiting a grant decision");
        await tx.updateAllowancePool(pool.id, { status: "ACTIVE", grantDecisionId: created.id });
        await tx.appendAuditEvent({
          organizationId: project.organizationId,
          projectId: project.id,
          actorId: args.approverUserId,
          actorEmail: args.approverEmail,
          action: "allowance.activated",
          targetType: "ALLOWANCE_POOL",
          targetId: pool.id,
          before: { status: pool.status },
          after: { status: "ACTIVE", grantDecisionId: created.id },
          correlationId: ctxInfo?.correlationId ?? "no-correlation",
          ip: ctxInfo?.ip ?? args.req.ip ?? null,
        });
      }
    }
    // Approved changes with a linked pool draw down in the same transaction.
    // Direct change approvals only: bundle approvals ignore draw links. The
    // touch serializes concurrent decisions so two approvals cannot overdraw.
    if (args.input.decision === "APPROVED" && fresh.changeRequestId) {
      const change = targetChanges.find((c) => c.id === fresh.changeRequestId);
      if (change?.drawAllowancePoolId) {
        const pool = await tx.findAllowancePoolById(change.drawAllowancePoolId);
        if (!pool || pool.projectId !== approval.projectId) throw DomainError.notFound("Allowance pool not found");
        if (!pool.enabled || pool.status !== "ACTIVE") throw DomainError.conflict("The linked allowance pool is no longer active");
        await tx.touchAllowancePool(pool.id);
        if (await tx.findDrawDownByChange(change.id)) {
          throw DomainError.conflict("This change already drew from its allowance pool");
        }
        const impact = await tx.findLatestImpact(change.id);
        const draw = drawAmountFor({ kind: pool.kind, priceMinor: impact?.priceMinor ?? null, effortDays: impact?.effortDays ?? null });
        const drawBlockerMessage = drawBlocker({
          kind: pool.kind,
          totalHours: pool.totalHours,
          totalMinor: pool.totalMinor,
          drawDowns: await tx.listDrawDownsByPool(pool.id),
          draw,
        });
        if (drawBlockerMessage) throw DomainError.conflict(drawBlockerMessage);
        const notifiedAt = nowIso();
        const drawDown = await tx.createDrawDown({
          poolId: pool.id,
          changeRequestId: change.id,
          hours: draw.hours,
          amountMinor: draw.amountMinor,
          notifiedAt,
          objectionDeadline: objectionDeadline(notifiedAt, pool.objectionWindowHours),
        });
        await tx.appendAuditEvent({
          organizationId: project.organizationId,
          projectId: project.id,
          actorId: args.approverUserId,
          actorEmail: args.approverEmail,
          action: "allowance.drawn",
          targetType: "ALLOWANCE_DRAW_DOWN",
          targetId: drawDown.id,
          after: { changeId: change.id, hours: draw.hours, amountMinor: draw.amountMinor, objectionDeadline: drawDown.objectionDeadline },
          correlationId: ctxInfo?.correlationId ?? "no-correlation",
          ip: ctxInfo?.ip ?? args.req.ip ?? null,
        });
        const amount = pool.kind === "AMOUNT" ? `${pool.currency} ${((draw.amountMinor ?? 0) / 100).toFixed(2)}` : `${draw.hours}h`;
        for (const m of await tx.listProjectMembers(approval.projectId)) {
          if (m.role !== "CLIENT_ADMIN" && m.role !== "CLIENT_APPROVER") continue;
          const user = await tx.findUserById(m.userId);
          if (!user) continue;
          const body = `${amount} drew from “${pool.name}” for ${change.number} (${change.title}). Object by ${drawDown.objectionDeadline} if you disagree.`;
          await notify(tx, {
            userId: user.id,
            projectId: approval.projectId,
            organizationId: project.organizationId,
            type: "ALLOWANCE_DRAWN",
            title: `Allowance draw: ${change.number}`,
            body,
            link: `/projects/${approval.projectId}`,
            email: { to: user.email, subject: `Allowance draw: ${change.number}`, text: body },
          });
        }
      }
    }
    return created;
  });

  // Notify the agency team of the decision.
  const members = await ctx.store.listProjectMembers(project.id);
  for (const m of members) {
    if (m.userId === args.approverUserId) continue;
    if (m.role !== "LEAD" && m.role !== "MEMBER") continue;
    const user = await ctx.store.findUserById(m.userId);
    if (!user) continue;
    await notify(ctx.store, {
      userId: user.id,
      projectId: project.id,
      organizationId: project.organizationId,
      type: "APPROVAL_DECIDED",
      title: `Decision on ${approval.title ?? "review package"}: ${args.input.decision}`,
      body: args.input.comment ?? `The client decided: ${args.input.decision}.`,
      link: approval.changeRequestId ? `/projects/${project.id}/changes/${approval.changeRequestId}` : `/projects/${project.id}`,
      email: {
        to: user.email,
        subject: `Decision: ${args.input.decision} — ${approval.title ?? ""}`,
        text: `Decision: ${args.input.decision}${args.input.comment ? `\n\nComment: ${args.input.comment}` : ""}`,
      },
    });
  }
  return decision;
}

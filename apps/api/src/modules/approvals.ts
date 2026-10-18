import { Router } from "express";
import { z } from "zod";
import { DecideApprovalSchema, ListQuerySchema, SendApprovalSchema } from "@scopelock/contracts";
import {
  ApprovalTransitions,
  BundleTransitions,
  ChangeTransitions,
  DomainError,
  aggregatePolicy,
  assertOptionAgreement,
  assertSendableOptions,
  assertTransition,
  assertValidChoice,
  checksumOf,
  currentTurn,
  STEP_UP_MAX_ATTEMPTS,
  STEP_UP_TTL_MINUTES,
  assertChallengeUsable,
  assertMayRequest,
  drawAmountFor,
  drawBlocker,
  effectiveStepUp,
  generateStepUpCode,
  hashStepUpCode,
  newToken,
  normalizeTypedName,
  objectionDeadline,
  resolvePolicyMode,
  sha256Hex,
  type ApprovalPolicy,
  type PolicyMode,
  type PolicyOutcome,
  type PolicyVote,
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
  ApprovalDecision,
  ApprovalRequest,
  ApprovalToken,
  Bundle,
  ChangeRequest,
  ProjectSettings,
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
  const options = await store.listOptionsByChange(change.id);
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
    options: options.map((o) => ({
      optionId: o.id,
      label: o.label,
      description: o.description,
      effortDays: o.effortDays,
      priceMinor: o.priceMinor,
      currency: o.currency,
      timelineDays: o.timelineDays,
      milestoneEffect: o.milestoneEffect,
      risks: o.risks,
      exclusions: o.exclusions,
      notes: o.notes,
    })),
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
    // Bundles decide member changes as a whole; per-change options stay out.
    options: [],
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

/** Canonical approver identity: user id when known, else lowercased email. */
export function approverKey(userId: string | null, email: string | null): string {
  return userId ?? (email ?? "").toLowerCase();
}

/** Effective step-up for a review: project pins win, else the org default, else off. */
export function resolveStepUp(org: { settings?: unknown } | null, project: { settings?: unknown }): { otp: boolean; typedName: boolean } {
  const orgSettings = (org?.settings ?? {}) as Record<string, unknown>;
  const projectSettings = (project.settings ?? {}) as Record<string, unknown>;
  return effectiveStepUp(orgSettings.stepUp, projectSettings.stepUp);
}

export function decisionVote(d: ApprovalDecision): PolicyVote {
  return { tokenId: d.tokenId, approverKey: approverKey(d.approverUserId, d.approverEmail), decision: d.decision };
}

/**
 * Legacy file-store rows predate the policy column (the Prisma migration
 * backfills ANY at the DB). Defaulting to ANY here preserves their
 * first-decision-wins behavior instead of crashing on decide/review.
 */
export function policyOf(approval: Pick<ApprovalRequest, "policy">): ApprovalPolicy {
  return approval.policy ?? { mode: "ANY", approverOrder: [] };
}

export interface PolicyStateView {
  outcome: PolicyOutcome;
  yourTurn: boolean;
  yourDecision: PolicyVote["decision"] | null;
  approvers: Array<{ approverKey: string; email: string | null; decision: PolicyVote["decision"] | null; turn: boolean }>;
}

/** Per-approver read model for the review page: who has voted, whose turn, yours. */
export function policyStateFor(
  approval: Pick<ApprovalRequest, "policy">,
  tokens: Array<Pick<ApprovalToken, "approverUserId" | "approverEmail">>,
  decisions: ApprovalDecision[],
  viewerKey: string,
): PolicyStateView {
  const keys = tokens.map((t) => approverKey(t.approverUserId, t.approverEmail ?? ""));
  const votes = decisions.map(decisionVote);
  const policy = policyOf(approval);
  const outcome = aggregatePolicy(policy, keys, votes);
  const turn = currentTurn(policy, keys, votes);
  const voted = new Map(votes.map((v) => [v.approverKey, v.decision]));
  return {
    outcome,
    yourTurn: turn === null || turn === viewerKey,
    yourDecision: voted.get(viewerKey) ?? null,
    approvers: tokens.map((t) => {
      const key = approverKey(t.approverUserId, t.approverEmail ?? "");
      return { approverKey: key, email: t.approverEmail, decision: voted.get(key) ?? null, turn: turn === key };
    }),
  };
}

/**
 * Policy attached at send time: explicit override wins, else the project's
 * amount thresholds against the priced impact, else ANY (first-decision-wins,
 * preserving historical behavior for single-approver packages).
 */
export function resolveSendPolicy(args: {
  settings: ProjectSettings;
  priceMinor: number | null;
  overrideMode?: PolicyMode;
  approvers: Array<{ userId: string | null; email: string }>;
}): { mode: PolicyMode; approverOrder: string[] } {
  const rules = args.settings.approvalPolicies ?? [];
  const mode = args.overrideMode ?? (rules.length > 0 ? resolvePolicyMode(rules, args.priceMinor) : "ANY");
  const keys = args.approvers.map((a) => approverKey(a.userId, a.email));
  return { mode, approverOrder: mode === "SEQUENTIAL" ? keys : [] };
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
    const project = await ctx.store.findProjectById(change.projectId);
    if (!project) throw DomainError.notFound("Project not found");
    const sendImpact = await ctx.store.findLatestImpact(change.id);
    const sendOptions = await ctx.store.listOptionsByChange(change.id);
    // Blockers already rejected invalid options; tier on the priciest
    // alternative so bigger commitments face the stricter rule.
    const optionsTier = sendOptions.length > 0 ? assertSendableOptions(sendOptions) : null;
    const basePrice = sendImpact?.priceMinor ?? null;
    const policy = resolveSendPolicy({
      settings: project.settings,
      priceMinor: optionsTier !== null ? Math.max(basePrice ?? 0, optionsTier) : basePrice,
      overrideMode: input.policyMode,
      approvers,
    });
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
        policy,
        expiresAt: input.expiresAt,
        sentAt: nowIso(),
        sentBy: auth.user.id,
        createdBy: auth.user.id,
        invalidatedReason: null,
        supersededBy: null,
        remindersSent: [],
        chosenOptionId: null,
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
      after: { changeId: change.id, checksum, approvers: approvers.map((a) => a.email), policy: policy.mode },
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
      const bundleProject = await ctx.store.findProjectById(bundle.projectId);
      if (!bundleProject) throw DomainError.notFound("Project not found");
      const bundleMembers = await ctx.store.listChanges(bundle.projectId, { bundleId: bundle.id });
      const bundlePrices = await Promise.all(bundleMembers.map((m) => ctx.store.findLatestImpact(m.id)));
      const priced = bundlePrices.map((i) => i?.priceMinor ?? null).filter((p): p is number => p !== null);
      const bundlePolicy = resolveSendPolicy({
        settings: bundleProject.settings,
        priceMinor: priced.length > 0 ? priced.reduce((a, b) => a + b, 0) : null,
        overrideMode: input.policyMode,
        approvers,
      });
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
          policy: bundlePolicy,
          expiresAt: input.expiresAt,
          sentAt: nowIso(),
          sentBy: auth.user.id,
          createdBy: auth.user.id,
          invalidatedReason: null,
          supersededBy: null,
          remindersSent: [],
          chosenOptionId: null,
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
        after: { bundleId: bundle.id, checksum, policy: bundlePolicy.mode },
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
            stepUp: resolveStepUp(access.org, access.project),
            policyState: policyStateFor(byId, tokens, decisions, approverKey(auth.user.id, auth.user.email)),
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
      const tokens = await ctx.store.listApprovalTokens(approval.id);
      res.json({
        status: approval.status,
        title: approval.title,
        package: approval.package,
        checksum: approval.checksum,
        expiresAt: approval.expiresAt,
        policy: policyOf(approval),
        chosenOptionId: approval.chosenOptionId ?? null,
        stepUp: resolveStepUp(org, project),
        policyState: policyStateFor(approval, tokens, decisions, approverKey(token.approverUserId, token.approverEmail ?? "")),
        decisions: decisions.map((d) => ({
          decision: d.decision,
          comment: d.comment,
          approverEmail: d.approverEmail,
          optionId: d.optionId,
          optionLabel: d.optionId ? (approval.package.options ?? []).find((o) => o.optionId === d.optionId)?.label ?? null : null,
          typedName: d.typedName,
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
    "/approval-requests/:ref/step-up",
    rateLimit(ctx.env, "token"),
    validateParams(z.object({ ref: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      const ref = req.params.ref as string;
      // Same dual shape as decide: approval id for sessions, token for links.
      let approval: ApprovalRequest;
      let tokenId: string | null;
      let key: string;
      let email: string | null;
      if (auth) {
        const byId = await ctx.store.findApprovalById(ref);
        if (byId) {
          const access = await requireProjectAccess(ctx.store, auth.user.id, byId.projectId);
          requireAction(access.access, "approval.view");
          approval = byId;
          tokenId = null;
          key = approverKey(auth.user.id, auth.user.email);
          email = auth.user.email;
        } else {
          const loaded = await loadTokenPackage(ctx, ref);
          approval = loaded.approval;
          tokenId = loaded.token.id;
          key = approverKey(loaded.token.approverUserId, loaded.token.approverEmail);
          email = loaded.token.approverEmail;
        }
      } else {
        const loaded = await loadTokenPackage(ctx, ref);
        approval = loaded.approval;
        tokenId = loaded.token.id;
        key = approverKey(loaded.token.approverUserId, loaded.token.approverEmail);
        email = loaded.token.approverEmail;
      }
      if (approval.status !== "SENT") {
        throw DomainError.conflict(`This package is ${approval.status} and can no longer be decided`, {
          status: approval.status,
        });
      }
      if (approval.expiresAt && approval.expiresAt <= nowIso()) {
        throw DomainError.gone("This review package has expired");
      }
      const project = await ctx.store.findProjectById(approval.projectId);
      if (!project) throw DomainError.notFound("Review package not found");
      const org = await ctx.store.findOrganizationById(project.organizationId);
      if (!resolveStepUp(org, project).otp) {
        throw DomainError.unprocessable("This review does not ask for a verification code");
      }
      if (!email) throw DomainError.unprocessable("This review link has no email address to send a code to");
      const now = nowIso();
      const mine = (await ctx.store.listStepUpChallenges(approval.id))
        .filter((c) => c.approverKey === key && (c.tokenId ?? null) === (tokenId ?? null))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      assertMayRequest(
        mine.filter((c) => !c.consumedAt && c.expiresAt > now),
        Date.now(),
      );
      const code = generateStepUpCode();
      const ctxInfo = getContext();
      const challenge = await ctx.store.transaction(async (tx) => {
        const created = await tx.createStepUpChallenge({
          approvalRequestId: approval.id,
          tokenId,
          approverKey: key,
          codeHash: hashStepUpCode(code),
          expiresAt: new Date(Date.now() + STEP_UP_TTL_MINUTES * 60_000).toISOString(),
          maxAttempts: STEP_UP_MAX_ATTEMPTS,
        });
        await tx.enqueueOutbox({
          type: "EMAIL",
          payload: {
            to: email,
            subject: `Your verification code for “${approval.title ?? "the review"}”`,
            text:
              `Your ScopeLock verification code is: ${code}\n\n` +
              `Enter it on the review page within ${STEP_UP_TTL_MINUTES} minutes to record your decision. ` +
              `If you did not request this, ignore this email — the code expires on its own.`,
            organizationId: project.organizationId,
            projectId: project.id,
            notificationType: "STEP_UP_CODE",
          },
          idempotencyKey: `stepup:${created.id}`,
        });
        await tx.appendAuditEvent({
          organizationId: project.organizationId,
          projectId: project.id,
          actorId: null,
          actorEmail: email,
          action: "approval.step_up_requested",
          targetType: "APPROVAL",
          targetId: approval.id,
          after: { tokenId, expiresAt: created.expiresAt },
          correlationId: ctxInfo?.correlationId ?? "no-correlation",
          ip: ctxInfo?.ip ?? req.ip ?? null,
        });
        return created;
      });
      res.status(202).json({ expiresAt: challenge.expiresAt, email });
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

/** Pre-decision guards, checked before and inside the transaction (races re-verify). */
function assertDecideAllowed(
  approval: ApprovalRequest,
  approverKeys: string[],
  prior: ApprovalDecision[],
  key: string,
): void {
  if (!approverKeys.includes(key)) {
    throw DomainError.forbidden("You are not an approver of this package");
  }
  if (prior.some((d) => decisionVote(d).approverKey === key)) {
    throw DomainError.conflict("You have already decided on this package");
  }
  const turn = currentTurn(policyOf(approval), approverKeys, prior.map(decisionVote));
  if (turn !== null && turn !== key) {
    throw DomainError.conflict("It is not your turn yet — approvers decide in order");
  }
}

/**
 * Burns one OTP challenge for this exact approval + token + approver. Wrong
 * guesses count against the live challenge (attempt-capped); a match consumes
 * it atomically with the decision so codes are single-use.
 */
async function consumeStepUpChallenge(
  tx: Store,
  approvalId: string,
  key: string,
  tokenId: string | null,
  otp: string | null,
  now: string,
): Promise<void> {
  if (!otp) throw DomainError.unprocessable("Enter the 6-digit code from the email");
  const mine = (await tx.listStepUpChallenges(approvalId))
    .filter((c) => c.approverKey === key && (c.tokenId ?? null) === (tokenId ?? null))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const live = mine.find((c) => !c.consumedAt && c.expiresAt > now);
  if (!live) {
    if (mine.some((c) => !c.consumedAt)) throw DomainError.gone("This code has expired — request a fresh one");
    throw DomainError.unprocessable("No verification code was requested for this review — request one first");
  }
  assertChallengeUsable(live, now);
  if (hashStepUpCode(otp) !== live.codeHash) {
    // The guess is counted OUTSIDE this transaction (which rolls back on
    // throw); recordDecision picks up the challenge id from details.
    throw DomainError.unprocessable("That code doesn't match — check the email and try again", {
      stepUpChallengeId: live.id,
    });
  }
  await tx.updateStepUpChallenge(live.id, { consumedAt: now, attempts: live.attempts + 1 });
}

async function recordDecision(ctx: AppContext, approval: ApprovalRequest, args: DecideInput): Promise<unknown> {
  if (approval.status !== "SENT") {
    throw DomainError.conflict(`This package is ${approval.status} and can no longer be decided`, {
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
  const key = approverKey(args.approverUserId, args.approverEmail);
  const tokens = await ctx.store.listApprovalTokens(approval.id);
  const approverKeys = tokens.map((t) => approverKey(t.approverUserId, t.approverEmail ?? ""));
  assertDecideAllowed(approval, approverKeys, await ctx.store.listDecisions(approval.id), key);

  const result = await ctx.store.transaction(async (tx) => {
    const fresh = await tx.findApprovalById(approval.id);
    if (!fresh || fresh.status !== "SENT") {
      throw DomainError.conflict("This package was just decided or withdrawn. Refresh to see its status.");
    }
    // Bind the decision to the exact reviewed bytes.
    if (checksumOf(fresh.package) !== fresh.checksum) {
      throw DomainError.conflict("This package changed after it was sent and must be re-sent before deciding");
    }
    const prior = await tx.listDecisions(fresh.id);
    assertDecideAllowed(fresh, approverKeys, prior, key);
    // Step-up gates the vote itself, whatever the verdict: identity first.
    const stepUpNow = nowIso();
    const liveProject = (await tx.findProjectById(approval.projectId)) ?? project;
    const stepUp = resolveStepUp(await tx.findOrganizationById(liveProject.organizationId), liveProject);
    const typedName = normalizeTypedName(args.input.typedName, stepUp.typedName);
    if (stepUp.otp) {
      await consumeStepUpChallenge(tx, fresh.id, key, args.tokenId, args.input.otp ?? null, stepUpNow);
    }
    const snapshots = fresh.package.options ?? [];
    const optionId = args.input.optionId ?? null;
    if (snapshots.length > 0) {
      if (args.input.decision !== "APPROVED") {
        if (optionId) throw DomainError.unprocessable("An option choice only applies to approvals");
      } else {
        if (!optionId) throw DomainError.unprocessable("This package offers proposal options — pick exactly one to approve");
        assertValidChoice(snapshots, optionId);
        assertOptionAgreement(
          prior.filter((d) => d.decision === "APPROVED").map((d) => d.optionId),
          optionId,
        );
      }
    } else if (optionId) {
      throw DomainError.unprocessable("This package has no proposal options to choose from");
    }
    const created = await tx.createDecision({
      approvalRequestId: fresh.id,
      approverUserId: args.approverUserId,
      approverEmail: args.approverEmail,
      tokenId: args.tokenId,
      decision: args.input.decision,
      comment: args.input.comment?.trim() || null,
      optionId: args.input.decision === "APPROVED" ? optionId : null,
      typedName,
      checksum: fresh.checksum,
      ip: ctxInfo?.ip ?? args.req.ip ?? null,
      userAgent: args.req.headers["user-agent"]?.slice(0, 300) ?? null,
    });
    const outcome: PolicyOutcome = aggregatePolicy(policyOf(fresh), approverKeys, [...prior.map(decisionVote), decisionVote(created)]);
    await tx.appendAuditEvent({
      organizationId: project.organizationId,
      projectId: project.id,
      actorId: args.approverUserId,
      actorEmail: args.approverEmail,
      action: "approval.decided",
      targetType: "APPROVAL",
      targetId: fresh.id,
      before: { status: "SENT" },
      after: {
        status: outcome.state === "PENDING" ? "SENT" : "DECIDED",
        decision: args.input.decision,
        outcome: outcome.state,
        optionId: created.optionId,
        typedName: created.typedName,
        checksum: fresh.checksum,
      },
      correlationId: ctxInfo?.correlationId ?? "no-correlation",
      ip: ctxInfo?.ip ?? args.req.ip ?? null,
    });
    // Partial outcomes record the vote and stop: side effects apply exactly
    // once, when the policy reaches a terminal state.
    if (outcome.state === "PENDING") return { created, outcome };
    const terminal = outcome.state;
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
        if (terminal === "APPROVED") {
          assertTransition(BundleTransitions, bundle.status, "APPROVED", "bundle");
          await tx.updateBundle(bundle.id, { status: "APPROVED" });
        } else if (terminal === "REJECTED") {
          assertTransition(BundleTransitions, bundle.status, "REJECTED", "bundle");
          await tx.updateBundle(bundle.id, { status: "REJECTED" });
        } else {
          await tx.updateBundle(bundle.id, { status: "DRAFT" });
        }
      }
    }
    // A blocked request cannot be marked approved: re-verify DEPENDS_ON
    // prerequisites at decision time (they may have regressed since send).
    if (terminal === "APPROVED") {
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
    const nextStatus = terminal === "APPROVED" ? "APPROVED" : terminal === "REJECTED" ? "REJECTED" : "NEEDS_CLARIFICATION";
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
        properties: { number: change.number, decision: terminal },
        actorId: args.approverUserId,
      });
    }
    // The client's pick becomes the change's effective impact, BEFORE any
    // draw-down reads it: ledger, export, and pool draws all see the chosen
    // option, attributed to the decision. Snapshot ids make this exact.
    if (terminal === "APPROVED" && optionId && fresh.changeRequestId) {
      const chosen = assertValidChoice(snapshots, optionId);
      await tx.createImpact({
        changeRequestId: fresh.changeRequestId,
        effortDays: chosen.effortDays,
        priceMinor: chosen.priceMinor,
        rateCardId: null,
        templateId: null,
        pricing: null,
        overrideReason: null,
        currency: chosen.currency,
        timelineDays: chosen.timelineDays,
        milestoneEffect: chosen.milestoneEffect,
        risks: chosen.risks,
        exclusions: chosen.exclusions,
        notes: `Chosen option "${chosen.label}" (decided ${now}).${chosen.notes ? ` ${chosen.notes}` : ""}`,
        confidence: "MEDIUM",
        createdBy: args.approverUserId ?? fresh.createdBy,
      });
      await tx.updateApproval(fresh.id, { chosenOptionId: optionId });
    }
    // Allowance grant decisions activate the pool itself — the grant IS the
    // client-approved decision, so draw-downs never become auto-approval.
    if (fresh.allowancePoolId) {
      const pool = await tx.findAllowancePoolById(fresh.allowancePoolId);
      if (!pool || pool.projectId !== approval.projectId) throw DomainError.notFound("Allowance pool not found");
      if (terminal === "APPROVED") {
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
    if (terminal === "APPROVED" && fresh.changeRequestId) {
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
    return { created, outcome };
  }).catch(async (err: unknown) => {
    // A wrong OTP guess rolls the decision tx back, so the attempt is counted
    // here, outside it. Anything else rethrows untouched.
    const challengeId =
      err instanceof DomainError && typeof err.details?.stepUpChallengeId === "string" ? err.details.stepUpChallengeId : null;
    if (challengeId) {
      const challenges = await ctx.store.listStepUpChallenges(approval.id);
      const live = challenges.find((c) => c.id === challengeId);
      if (live && !live.consumedAt) {
        await ctx.store.updateStepUpChallenge(live.id, { attempts: live.attempts + 1 });
      }
    }
    throw err;
  });

  if (result.outcome.state === "PENDING") {
    // Sequential runs nudge whoever is up next; other partial votes stay
    // quiet until the policy resolves, so approvers are not spammed.
    const next = currentTurn(policyOf(approval), approverKeys, [...(await ctx.store.listDecisions(approval.id)).map(decisionVote)]);
    const nextToken = next ? tokens.find((t) => approverKey(t.approverUserId, t.approverEmail ?? "") === next) : undefined;
    if (nextToken) {
      await notifyApprovalRequested(ctx, {
        orgId: project.organizationId,
        projectId: project.id,
        approvalId: approval.id,
        title: approval.title ?? "review package",
        expiresAt: approval.expiresAt ?? nowIso(),
        approvers: [{ userId: nextToken.approverUserId, email: nextToken.approverEmail ?? "" }],
      });
    }
    return { ...result.created, outcome: result.outcome };
  }

  // Notify the agency team of the terminal decision.
  const terminalState = result.outcome.state;
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
      title: `Decision on ${approval.title ?? "review package"}: ${terminalState}`,
      body: args.input.comment ?? `The client decided: ${terminalState}.`,
      link: approval.changeRequestId ? `/projects/${project.id}/changes/${approval.changeRequestId}` : `/projects/${project.id}`,
      email: {
        to: user.email,
        subject: `Decision: ${terminalState} — ${approval.title ?? ""}`,
        text: `Decision: ${terminalState}${args.input.comment ? `\n\nComment: ${args.input.comment}` : ""}`,
      },
    });
  }
  return { ...result.created, outcome: result.outcome };
}

import { Router } from "express";
import { z } from "zod";
import {
  CreateAllowancePoolSchema,
  ListQuerySchema,
  ObjectDrawDownSchema,
  ResolveDrawDownSchema,
  SendApprovalSchema,
  UpdateAllowancePoolSchema,
} from "@scopelock/contracts";
import {
  DomainError,
  checksumOf,
  newToken,
  objectionBlocker,
  poolBalance,
  sha256Hex,
} from "@scopelock/domain";
import type { AppContext } from "../app-context.js";
import { asyncHandler } from "../http/errors.js";
import { authenticate, requireAuth } from "../http/auth.js";
import { requireAction, requireProjectAccess } from "../http/access.js";
import { validateBody, validateParams, validateQuery } from "../http/validate.js";
import { paginateList } from "../http/pagination.js";
import type { ApiRequest } from "../http/types.js";
import { audit } from "../lib/audit.js";
import { notify } from "../lib/notify.js";
import { nowIso, type AllowanceDrawDown, type AllowancePool, type ReviewPackageSnapshot, type Store } from "../store/index.js";
import { notifyApprovalRequested, resolveApprovers, resolveSendPolicy } from "./approvals.js";

interface PoolView extends AllowancePool {
  balance: ReturnType<typeof poolBalance>;
  drawDowns: Array<AllowanceDrawDown & { changeNumber: string; changeTitle: string }>;
}

/** Immutable grant package: the pool terms the client approves. */
export function buildPoolPackage(pool: AllowancePool): ReviewPackageSnapshot {
  return {
    title: `Allowance grant: ${pool.name}`,
    changeId: null,
    bundleId: null,
    request: null,
    members: [],
    impact: null,
    options: [],
    requirements: [],
    attachments: [],
    assumptions: [],
    exclusions: [],
    sentAt: nowIso(),
    allowance: {
      poolId: pool.id,
      kind: pool.kind,
      totalHours: pool.totalHours,
      totalMinor: pool.totalMinor,
      currency: pool.currency,
      objectionWindowHours: pool.objectionWindowHours,
    },
  };
}

/** Terms edits invalidate SENT grant approvals so clients never grant stale terms. */
export async function invalidateApprovalsForPool(store: Store, poolId: string, reason: string): Promise<void> {
  for (const approval of await store.listApprovalsForPool(poolId)) {
    if (approval.status !== "SENT") continue;
    await store.updateApproval(approval.id, { status: "INVALIDATED", invalidatedReason: reason });
    const project = await store.findProjectById(approval.projectId);
    if (project) {
      await audit(store, {
        organizationId: project.organizationId,
        projectId: project.id,
        action: "approval.invalidated",
        targetType: "APPROVAL",
        targetId: approval.id,
        after: { reason },
      });
    }
  }
}

export function allowanceRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use(authenticate(ctx.store));

  async function withBalance(store: Store, pool: AllowancePool): Promise<PoolView> {
    const drawDowns = await store.listDrawDownsByPool(pool.id);
    const balance = poolBalance({
      kind: pool.kind,
      totalHours: pool.totalHours,
      totalMinor: pool.totalMinor,
      drawDowns: drawDowns.map((d) => ({ hours: d.hours, amountMinor: d.amountMinor, status: d.status })),
    });
    const enriched: PoolView["drawDowns"] = [];
    for (const d of drawDowns) {
      const change = await store.findChangeById(d.changeRequestId);
      enriched.push({ ...d, changeNumber: change?.number ?? "?", changeTitle: change?.title ?? "?" });
    }
    return { ...pool, balance, drawDowns: enriched };
  }

  router.get(
    "/projects/:id/allowance-pools",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateQuery(ListQuerySchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const q = (req as ApiRequest).validatedQuery as { cursor?: string; limit: number };
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "project.view");
      const pools = await ctx.store.listAllowancePools(access.project.id);
      const withBalances = [];
      for (const pool of pools) withBalances.push(await withBalance(ctx.store, pool));
      res.json(paginateList(withBalances, q));
    }),
  );

  router.post(
    "/projects/:id/allowance-pools",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(CreateAllowancePoolSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof CreateAllowancePoolSchema>;
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "allowance.manage");
      if (input.kind === "AMOUNT" && input.currency !== access.project.currency) {
        throw DomainError.unprocessable(`Pool currency must match the project currency (${access.project.currency})`);
      }
      const pool = await ctx.store.createAllowancePool({
        projectId: access.project.id,
        name: input.name,
        kind: input.kind,
        totalHours: input.totalHours ?? null,
        totalMinor: input.totalMinor ?? null,
        currency: input.currency ?? null,
        objectionWindowHours: input.objectionWindowHours,
        enabled: input.enabled,
        createdBy: auth.user.id,
      });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "allowance.created",
        targetType: "ALLOWANCE_POOL",
        targetId: pool.id,
        after: { name: pool.name, kind: pool.kind },
      });
      res.status(201).json(await withBalance(ctx.store, pool));
    }),
  );

  router.patch(
    "/allowance-pools/:id",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(UpdateAllowancePoolSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof UpdateAllowancePoolSchema>;
      const pool = await ctx.store.findAllowancePoolById(req.params.id as string);
      if (!pool) throw DomainError.notFound("Allowance pool not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, pool.projectId);
      requireAction(access.access, "allowance.manage");
      if (pool.status === "CLOSED") throw DomainError.conflict("Closed pools cannot be changed");
      const touchesTerms =
        input.name !== undefined || input.totalHours !== undefined || input.totalMinor !== undefined || input.objectionWindowHours !== undefined;
      if (pool.status === "ACTIVE" && (input.totalHours !== undefined || input.totalMinor !== undefined)) {
        throw DomainError.unprocessable("Active pool totals cannot change. Close this pool and grant a new one.");
      }
      if (input.status !== undefined) {
        // Activation happens only through a recorded client decision, never by edit.
        if (input.status === "ACTIVE") throw DomainError.unprocessable("Pools activate only through a client approval decision");
        if (input.status === "PROPOSED") throw DomainError.unprocessable("Pools cannot return to PROPOSED");
      }
      if (touchesTerms) {
        const sent = (await ctx.store.listApprovalsForPool(pool.id)).filter((a) => a.status === "SENT");
        if (sent.length > 0) await invalidateApprovalsForPool(ctx.store, pool.id, "Pool terms changed while awaiting decision");
      }
      if (input.status === "CLOSED") {
        await invalidateApprovalsForPool(ctx.store, pool.id, "Pool closed");
      }
      const updated = await ctx.store.updateAllowancePool(pool.id, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.totalHours !== undefined ? { totalHours: input.totalHours } : {}),
        ...(input.totalMinor !== undefined ? { totalMinor: input.totalMinor } : {}),
        ...(input.objectionWindowHours !== undefined ? { objectionWindowHours: input.objectionWindowHours } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "allowance.updated",
        targetType: "ALLOWANCE_POOL",
        targetId: pool.id,
        after: { name: updated.name, status: updated.status, enabled: updated.enabled },
      });
      res.json(await withBalance(ctx.store, updated));
    }),
  );

  router.post(
    "/allowance-pools/:id/approval-requests",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(SendApprovalSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof SendApprovalSchema>;
      const pool = await ctx.store.findAllowancePoolById(req.params.id as string);
      if (!pool) throw DomainError.notFound("Allowance pool not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, pool.projectId);
      requireAction(access.access, "allowance.manage");
      if (pool.status !== "PROPOSED") throw DomainError.unprocessable("Only PROPOSED pools can be sent for a grant decision");
      if (!pool.enabled) throw DomainError.unprocessable("Enable the pool before sending it for a grant decision");
      if (Date.parse(input.expiresAt) <= Date.now()) throw DomainError.unprocessable("Expiry must be in the future");
      const open = (await ctx.store.listApprovalsForPool(pool.id)).filter((a) => a.status === "SENT");
      if (open.length > 0) throw DomainError.conflict("This pool is already awaiting a grant decision");
      const approvers = await resolveApprovers(ctx.store, pool.projectId, input.approverUserIds, input.approverEmails);
      const pkg = buildPoolPackage(pool);
      if (input.title) pkg.title = input.title;
      const checksum = checksumOf(pkg);
      const tokens = approvers.map(() => newToken());
      const grantProject = await ctx.store.findProjectById(pool.projectId);
      if (!grantProject) throw DomainError.notFound("Project not found");
      const grantPolicy = resolveSendPolicy({
        settings: grantProject.settings,
        priceMinor: pool.kind === "AMOUNT" ? (pool.totalMinor ?? null) : null,
        overrideMode: input.policyMode,
        approvers,
      });
      const approval = await ctx.store.transaction(async (tx) => {
        const created = await tx.createApproval({
          projectId: pool.projectId,
          changeRequestId: null,
          bundleId: null,
          allowancePoolId: pool.id,
          title: pkg.title,
          package: pkg,
          checksum,
          status: "SENT",
          approverUserIds: approvers.filter((a) => a.userId).map((a) => a.userId as string),
          policy: grantPolicy,
          expiresAt: input.expiresAt,
          sentAt: nowIso(),
          sentBy: auth.user.id,
          createdBy: auth.user.id,
          invalidatedReason: null,
          supersededBy: null,
          remindersSent: [],
          chosenOptionId: null,
          acceptanceRequirementIds: [],
          deemedAt: null,
          escalatedAt: null,
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
        for (const old of await tx.listApprovalsForPool(pool.id)) {
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
        after: { allowancePoolId: pool.id, checksum, policy: grantPolicy.mode },
      });
      await notifyApprovalRequested(ctx, {
        orgId: access.org.id,
        projectId: access.project.id,
        approvalId: approval.id,
        title: pkg.title ?? `Allowance grant: ${pool.name}`,
        expiresAt: input.expiresAt,
        approvers,
      });
      res.status(201).json({
        approval,
        ...(ctx.env.NODE_ENV !== "production" ? { reviewUrls: tokens.map((t: string) => `${ctx.env.WEB_URL}/review/${t}`) } : {}),
      });
    }),
  );

  router.post(
    "/allowance-draw-downs/:id/object",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(ObjectDrawDownSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof ObjectDrawDownSchema>;
      const drawDown = await ctx.store.findDrawDownById(req.params.id as string);
      if (!drawDown) throw DomainError.notFound("Draw-down not found");
      const pool = await ctx.store.findAllowancePoolById(drawDown.poolId);
      if (!pool) throw DomainError.notFound("Allowance pool not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, pool.projectId);
      requireAction(access.access, "allowance.object");
      const blocker = objectionBlocker({ status: drawDown.status, deadline: drawDown.objectionDeadline, now: nowIso() });
      if (blocker) throw DomainError.conflict(blocker);
      const updated = await ctx.store.updateDrawDown(drawDown.id, {
        status: "OBJECTED",
        objectionReason: input.reason,
        objectedBy: auth.user.id,
        objectedAt: nowIso(),
      });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "allowance.objected",
        targetType: "ALLOWANCE_DRAW_DOWN",
        targetId: drawDown.id,
        after: { reason: input.reason },
      });
      for (const m of await ctx.store.listProjectMembers(pool.projectId)) {
        if (m.role !== "LEAD") continue;
        const user = await ctx.store.findUserById(m.userId);
        if (!user || user.id === auth.user.id) continue;
        await notify(ctx.store, {
          userId: user.id,
          projectId: pool.projectId,
          organizationId: access.org.id,
          type: "ALLOWANCE_OBJECTED",
          title: `Objection on ${pool.name} draw-down`,
          body: `${auth.user.email} objected: ${input.reason}`,
          link: `/projects/${pool.projectId}`,
          email: { to: user.email, subject: `Objection on ${pool.name} draw-down`, text: `${auth.user.email} objected: ${input.reason}` },
        });
      }
      res.json(updated);
    }),
  );

  router.post(
    "/allowance-draw-downs/:id/resolve",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(ResolveDrawDownSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof ResolveDrawDownSchema>;
      const drawDown = await ctx.store.findDrawDownById(req.params.id as string);
      if (!drawDown) throw DomainError.notFound("Draw-down not found");
      const pool = await ctx.store.findAllowancePoolById(drawDown.poolId);
      if (!pool) throw DomainError.notFound("Allowance pool not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, pool.projectId);
      requireAction(access.access, "allowance.manage");
      if (drawDown.status !== "OBJECTED") throw DomainError.conflict("Only OBJECTED draw-downs can be resolved");
      const updated = await ctx.store.updateDrawDown(drawDown.id, {
        status: input.resolution === "UPHOLD" ? "FINAL" : "RELEASED",
        resolutionNote: input.note,
        resolvedBy: auth.user.id,
        resolvedAt: nowIso(),
      });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "allowance.resolved",
        targetType: "ALLOWANCE_DRAW_DOWN",
        targetId: drawDown.id,
        after: { resolution: input.resolution, note: input.note },
      });
      const change = await ctx.store.findChangeById(drawDown.changeRequestId);
      for (const m of await ctx.store.listProjectMembers(pool.projectId)) {
        if (m.role !== "CLIENT_ADMIN" && m.role !== "CLIENT_APPROVER") continue;
        const user = await ctx.store.findUserById(m.userId);
        if (!user) continue;
        const body =
          input.resolution === "UPHOLD"
            ? `Your objection on the ${change?.number ?? "change"} draw-down was reviewed and the draw stands: ${input.note}`
            : `Your objection was accepted and the ${change?.number ?? "change"} draw-down was released back to “${pool.name}”: ${input.note}`;
        await notify(ctx.store, {
          userId: user.id,
          projectId: pool.projectId,
          organizationId: access.org.id,
          type: "ALLOWANCE_RESOLVED",
          title: `Draw-down ${input.resolution === "UPHOLD" ? "upheld" : "released"}`,
          body,
          link: `/projects/${pool.projectId}`,
          email: { to: user.email, subject: `Draw-down ${input.resolution === "UPHOLD" ? "upheld" : "released"}`, text: body },
        });
      }
      res.json(updated);
    }),
  );

  return router;
}

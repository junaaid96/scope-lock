import { Router } from "express";
import { z } from "zod";
import {
  CreateInvitationSchema,
  CreateOrganizationSchema,
  ListQuerySchema,
  UpdateMembershipSchema,
  UpdateOrganizationSchema,
} from "@scopelock/contracts";
import { DomainError, newToken, sha256Hex } from "@scopelock/domain";
import type { AppContext } from "../app-context.js";
import { publicUser } from "../app-context.js";
import { asyncHandler } from "../http/errors.js";
import { authenticate, requireAuth } from "../http/auth.js";
import { requireAction, requireOrgAccess } from "../http/access.js";
import { idempotency } from "../http/idempotency.js";
import { validateBody, validateParams, validateQuery } from "../http/validate.js";
import { paginateList } from "../http/pagination.js";
import type { ApiRequest } from "../http/types.js";
import { audit } from "../lib/audit.js";
import { PLAN_LIMITS } from "../lib/limits.js";
import { currentPeriod, nowIso, type Invitation } from "../store/index.js";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const IdParam = z.object({ id: z.string().min(1) });

/** Explicitly picked fields: never serialize tokenHash. */
function safeInvitation(inv: Invitation): { id: string; email: string; role: string; projectId: string | null; projectRole: string | null; status: string; expiresAt: string; createdAt: string; decidedAt: string | null } {
  return {
    id: inv.id,
    email: inv.email,
    role: inv.role,
    projectId: inv.projectId,
    projectRole: inv.projectRole,
    status: inv.status,
    expiresAt: inv.expiresAt,
    createdAt: inv.createdAt,
    decidedAt: inv.decidedAt,
  };
}

export function organizationRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use(authenticate(ctx.store));

  router.get(
    "/",
    requireAuth,
    validateQuery(ListQuerySchema),
    asyncHandler(async (req, res) => {
      const userId = (req as ApiRequest).auth?.user.id;
      if (!userId) throw DomainError.unauthorized("Authentication required");
      const q = (req as ApiRequest).validatedQuery as { cursor?: string; limit: number };
      const orgs = await ctx.store.listOrganizationsForUser(userId);
      const roles = await Promise.all(orgs.map((o) => ctx.store.findMembership(o.id, userId)));
      res.json(paginateList(orgs.map((o, i) => ({ ...o, role: roles[i]?.role ?? null })), q));
    }),
  );

  router.post(
    "/",
    requireAuth,
    validateBody(CreateOrganizationSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof CreateOrganizationSchema>;
      const result = await ctx.store.transaction(async (tx) => {
        const organization = await tx.createOrganization({ name: input.name });
        const membership = await tx.upsertMembership(organization.id, auth.user.id, "OWNER");
        return { organization, membership };
      });
      await audit(ctx.store, {
        organizationId: result.organization.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "organization.created",
        targetType: "ORGANIZATION",
        targetId: result.organization.id,
        after: { name: result.organization.name },
      });
      res.status(201).json({ ...result.organization, role: result.membership.role });
    }),
  );

  router.get(
    "/:id",
    requireAuth,
    validateParams(IdParam),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, req.params.id as string);
      res.json({ ...org, role: membership.role });
    }),
  );

  router.patch(
    "/:id",
    requireAuth,
    validateParams(IdParam),
    validateBody(UpdateOrganizationSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof UpdateOrganizationSchema>;
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction({ orgRole: membership.role, projectRole: null }, "org.manage");
      if (input.plan && membership.role !== "OWNER") {
        throw DomainError.forbidden("Only owners can change the plan");
      }
      const before = { name: org.name, plan: org.plan, aiEnabled: org.aiEnabled, branding: org.branding };
      const prevStepUp = (org.settings?.stepUp ?? {}) as { otp?: boolean | null; typedName?: boolean | null };
      const updated = await ctx.store.updateOrganization(org.id, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.plan !== undefined ? { plan: input.plan } : {}),
        ...(input.aiEnabled !== undefined ? { aiEnabled: input.aiEnabled } : {}),
        ...(input.branding !== undefined ? { branding: input.branding } : {}),
        ...(input.stepUp !== undefined
          ? {
              settings: {
                ...(org.settings ?? {}),
                stepUp: {
                  otp: "otp" in input.stepUp ? (input.stepUp.otp ?? null) : (prevStepUp.otp ?? null),
                  typedName: "typedName" in input.stepUp ? (input.stepUp.typedName ?? null) : (prevStepUp.typedName ?? null),
                },
              },
            }
          : {}),
      });
      await audit(ctx.store, {
        organizationId: org.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "organization.updated",
        targetType: "ORGANIZATION",
        targetId: org.id,
        before,
        after: { name: updated.name, plan: updated.plan, aiEnabled: updated.aiEnabled, branding: updated.branding },
      });
      res.json(updated);
    }),
  );

  // ----- Invitations -----
  router.post(
    "/:id/invitations",
    requireAuth,
    idempotency(ctx.store, "org-invite"),
    validateParams(IdParam),
    validateBody(CreateInvitationSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof CreateInvitationSchema>;
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction({ orgRole: membership.role, projectRole: null }, "org.invite");
      if ((input.role === "OWNER" || input.role === "ADMIN") && membership.role !== "OWNER" && membership.role !== "ADMIN") {
        throw DomainError.forbidden("Only owners and admins can invite owners or admins");
      }
      if (input.projectId) {
        const project = await ctx.store.findProjectById(input.projectId);
        if (!project || project.organizationId !== org.id) throw DomainError.notFound("Project not found");
        if (!input.projectRole) throw DomainError.unprocessable("projectRole is required when projectId is set");
      }
      const token = newToken();
      const invitation = await ctx.store.transaction(async (tx) => {
        const inv = await tx.createInvitation({
          organizationId: org.id,
          email: input.email,
          role: input.role,
          projectId: input.projectId ?? null,
          projectRole: input.projectRole ?? null,
          tokenHash: sha256Hex(token),
          expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
          createdBy: auth.user.id,
        });
        await tx.enqueueOutbox({
          type: "EMAIL",
          payload: {
            to: inv.email,
            subject: `You are invited to ${org.name} on ScopeLock`,
            text: `Accept within 7 days: ${ctx.env.WEB_URL}/accept-invite/${token}`,
            organizationId: org.id,
            notificationType: "INVITATION",
          },
          idempotencyKey: `invite:${inv.id}`,
        });
        return inv;
      });
      await audit(ctx.store, {
        organizationId: org.id,
        projectId: invitation.projectId,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "invitation.created",
        targetType: "INVITATION",
        targetId: invitation.id,
        after: { email: invitation.email, role: invitation.role },
      });
      res.status(201).json({
        invitation: safeInvitation(invitation),
        ...(ctx.env.NODE_ENV !== "production"
          ? { token, acceptUrl: `${ctx.env.WEB_URL}/accept-invite/${token}` }
          : {}),
      });
    }),
  );

  router.get(
    "/:id/invitations",
    requireAuth,
    validateParams(IdParam),
    validateQuery(ListQuerySchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const q = (req as ApiRequest).validatedQuery as { cursor?: string; limit: number };
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction({ orgRole: membership.role, projectRole: null }, "org.invite");
      const invitations = await ctx.store.listInvitations(org.id);
      res.json(paginateList(invitations.map(safeInvitation), q));
    }),
  );

  router.delete(
    "/:id/invitations/:invId",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1), invId: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction({ orgRole: membership.role, projectRole: null }, "org.invite");
      const invite = await ctx.store.findInvitationById(req.params.invId as string);
      if (!invite || invite.organizationId !== org.id) throw DomainError.notFound("Invitation not found");
      if (invite.status !== "PENDING") throw DomainError.conflict("Only pending invitations can be revoked");
      await ctx.store.updateInvitation(invite.id, { status: "REVOKED", decidedAt: nowIso() });
      await audit(ctx.store, {
        organizationId: org.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "invitation.revoked",
        targetType: "INVITATION",
        targetId: invite.id,
        before: { status: "PENDING" },
        after: { status: "REVOKED" },
      });
      res.json({ ok: true });
    }),
  );

  // ----- Members -----
  router.get(
    "/:id/members",
    requireAuth,
    validateParams(IdParam),
    validateQuery(ListQuerySchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const q = (req as ApiRequest).validatedQuery as { cursor?: string; limit: number };
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction({ orgRole: membership.role, projectRole: null }, "org.members.manage");
      const memberships = await ctx.store.listMemberships(org.id);
      const users = await Promise.all(memberships.map((m) => ctx.store.findUserById(m.userId)));
      res.json(
        paginateList(
          memberships.map((m, i) => ({ ...m, user: users[i] ? publicUser(users[i]) : null })),
          q,
        ),
      );
    }),
  );

  router.patch(
    "/:id/members/:userId",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1), userId: z.string().min(1) })),
    validateBody(UpdateMembershipSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof UpdateMembershipSchema>;
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction({ orgRole: membership.role, projectRole: null }, "org.members.manage");
      const target = await ctx.store.findMembership(org.id, req.params.userId as string);
      if (!target) throw DomainError.notFound("Membership not found");
      if (target.role === "OWNER" && input.role !== "OWNER") {
        const owners = (await ctx.store.listMemberships(org.id)).filter((m) => m.role === "OWNER");
        if (owners.length <= 1) throw DomainError.conflict("An organization must keep at least one owner");
      }
      const updated = await ctx.store.upsertMembership(org.id, target.userId, input.role);
      await audit(ctx.store, {
        organizationId: org.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "membership.role_changed",
        targetType: "MEMBERSHIP",
        targetId: updated.id,
        before: { role: target.role, userId: target.userId },
        after: { role: updated.role, userId: target.userId },
      });
      res.json(updated);
    }),
  );

  router.delete(
    "/:id/members/:userId",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1), userId: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction({ orgRole: membership.role, projectRole: null }, "org.members.manage");
      const target = await ctx.store.findMembership(org.id, req.params.userId as string);
      if (!target) throw DomainError.notFound("Membership not found");
      if (target.role === "OWNER") {
        const owners = (await ctx.store.listMemberships(org.id)).filter((m) => m.role === "OWNER");
        if (owners.length <= 1) throw DomainError.conflict("An organization must keep at least one owner");
      }
      await ctx.store.transaction(async (tx) => {
        await tx.deleteMembership(org.id, target.userId);
        const projects = await tx.listProjects(org.id);
        for (const p of projects) await tx.deleteProjectMember(p.id, target.userId);
        await tx.deleteUserSessions(target.userId);
      });
      await audit(ctx.store, {
        organizationId: org.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "membership.removed",
        targetType: "MEMBERSHIP",
        targetId: target.id,
        before: { role: target.role, userId: target.userId },
      });
      res.json({ ok: true });
    }),
  );

  // ----- Usage -----
  router.get(
    "/:id/usage",
    requireAuth,
    validateParams(IdParam),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction({ orgRole: membership.role, projectRole: null }, "org.usage.view");
      const period = currentPeriod();
      const usage = await ctx.store.getUsage(org.id, period);
      const projects = await ctx.store.listProjects(org.id);
      res.json({
        period,
        plan: org.plan,
        usage,
        limits: PLAN_LIMITS[org.plan],
        projectCount: projects.length,
      });
    }),
  );

  router.get(
    "/:id/metrics",
    requireAuth,
    validateParams(IdParam),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction({ orgRole: membership.role, projectRole: null }, "org.usage.view");
      // Weekly active projects: distinct projects with audit (scope) actions in the last 7 days.
      const weekStart = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const projects = await ctx.store.listProjects(org.id);
      const active = new Set<string>();
      let cursor: string | undefined;
      for (let i = 0; i < 10; i++) {
        const page = await ctx.store.listAuditEvents({ organizationId: org.id, cursor, limit: 100 });
        for (const e of page.items) {
          if (e.projectId && e.createdAt >= weekStart) active.add(e.projectId);
        }
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      res.json({ weekStart, projectCount: projects.length, weeklyActiveProjects: active.size });
    }),
  );

  return router;
}

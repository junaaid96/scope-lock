import { Router } from "express";
import { z } from "zod";
import { AddProjectMemberSchema, CreateProjectSchema, ListQuerySchema, UpdateProjectMemberSchema, UpdateProjectSchema } from "@scopelock/contracts";
import { DomainError, ProjectTransitions, assertTransition, resolvePolicyMode } from "@scopelock/domain";
import type { AppContext } from "../app-context.js";
import { publicUser } from "../app-context.js";
import { asyncHandler } from "../http/errors.js";
import { authenticate, requireAuth } from "../http/auth.js";
import { requireAction, requireOrgAccess, requireProjectAccess } from "../http/access.js";
import { validateBody, validateParams, validateQuery } from "../http/validate.js";
import { paginateList } from "../http/pagination.js";
import type { ApiRequest } from "../http/types.js";
import { audit } from "../lib/audit.js";
import { assertProjectQuota } from "../lib/limits.js";
import { currentPeriod } from "../store/index.js";

const OPEN_CHANGE_STATUSES = ["SUBMITTED", "TRIAGING", "NEEDS_CLARIFICATION", "ESTIMATING", "PENDING_APPROVAL"] as const;

export function projectRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use(authenticate(ctx.store));

  // Dashboard list: authorization-filtered with pending-work counts.
  router.get(
    "/",
    requireAuth,
    validateQuery(ListQuerySchema.merge(z.object({ organizationId: z.string().min(1) }))),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const q = (req as ApiRequest).validatedQuery as { organizationId: string; cursor?: string; limit: number };
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, q.organizationId);
      const all = await ctx.store.listProjects(org.id);
      const isOperator = membership.role === "OWNER" || membership.role === "ADMIN";
      const memberProjectIds = new Set(await ctx.store.listProjectIdsForUser(auth.user.id));
      const visible = all.filter((p) => isOperator || memberProjectIds.has(p.id));
      const data = await Promise.all(
        visible.map(async (p) => {
          const changes = await ctx.store.listChanges(p.id);
          const approvals = await ctx.store.listProjectApprovals(p.id);
          const openChanges = changes.filter((c) => (OPEN_CHANGE_STATUSES as readonly string[]).includes(c.status)).length;
          const pendingApprovals = approvals.filter((a) => a.status === "SENT").length;
          const myInbox = (await ctx.store.listInboxApprovals(auth.user.id, auth.user.email)).filter(
            (a) => a.projectId === p.id,
          ).length;
          const member = await ctx.store.findProjectMember(p.id, auth.user.id);
          return { ...p, myRole: member?.role ?? (isOperator ? "LEAD" : null), openChanges, pendingApprovals, myInbox };
        }),
      );
      res.json(paginateList(data, q));
    }),
  );

  router.post(
    "/",
    requireAuth,
    validateBody(CreateProjectSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof CreateProjectSchema>;
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, input.organizationId);
      requireAction({ orgRole: membership.role, projectRole: null }, "project.create");
      const client = await ctx.store.findClientById(input.clientId);
      if (!client || client.deletedAt || client.organizationId !== org.id) throw DomainError.notFound("Client not found");
      await assertProjectQuota(ctx.store, org.id, org.plan);
      if (input.settings?.approvalPolicies) {
        resolvePolicyMode(input.settings.approvalPolicies, null);
      }
      const project = await ctx.store.transaction(async (tx) => {
        const created = await tx.createProject({
          organizationId: org.id,
          clientId: client.id,
          name: input.name,
          currency: input.currency,
          budgetMinor: input.budgetMinor ?? null,
          startDate: input.startDate ?? null,
          targetDate: input.targetDate ?? null,
          settings: {
            aiEnabled: input.settings?.aiEnabled ?? true,
            reminderHoursBeforeExpiry: input.settings?.reminderHoursBeforeExpiry ?? [48, 24],
            approvalPolicies: input.settings?.approvalPolicies ?? [],
            stepUp: {
              otp: input.settings?.stepUp?.otp ?? null,
              typedName: input.settings?.stepUp?.typedName ?? null,
            },
            deemedAcceptanceDays: input.settings?.deemedAcceptanceDays ?? null,
            escalation: {
              afterHours: input.settings?.escalation?.afterHours ?? null,
              target: input.settings?.escalation?.target ?? "AGENCY_LEAD",
            },
            defaultLocale: input.settings?.defaultLocale ?? null,
          },
        });
        await tx.upsertProjectMember(created.id, auth.user.id, "LEAD");
        await tx.bumpUsage(org.id, currentPeriod(), { projectsCreated: 1 });
        return created;
      });
      await audit(ctx.store, {
        organizationId: org.id,
        projectId: project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "project.created",
        targetType: "PROJECT",
        targetId: project.id,
        after: { name: project.name, clientId: client.id },
      });
      await ctx.store.recordMetric({ organizationId: org.id, projectId: project.id, name: "project.created", actorId: auth.user.id });
      res.status(201).json(project);
    }),
  );

  router.get(
    "/:id",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "project.view");
      const client = await ctx.store.findClientById(access.project.clientId);
      const changes = await ctx.store.listChanges(access.project.id);
      const approvals = await ctx.store.listProjectApprovals(access.project.id);
      const versions = await ctx.store.listProjectScopeVersions(access.project.id);
      const published = versions.filter((v) => v.status === "PUBLISHED").sort((a, b) => b.sequence - a.sequence)[0] ?? null;
      res.json({
        ...access.project,
        client,
        myRole: access.projectMember?.role ?? null,
        counts: {
          openChanges: changes.filter((c) => (OPEN_CHANGE_STATUSES as readonly string[]).includes(c.status)).length,
          pendingApprovals: approvals.filter((a) => a.status === "SENT").length,
          publishedSequence: published?.sequence ?? null,
        },
      });
    }),
  );

  router.patch(
    "/:id",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(UpdateProjectSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof UpdateProjectSchema>;
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "project.manage");
      if (input.status && input.status !== access.project.status) {
        assertTransition(ProjectTransitions, access.project.status, input.status, "project");
      }
      if (input.settings?.approvalPolicies) {
        // Validates ascending ceilings (throws 422); price resolves at send time.
        resolvePolicyMode(input.settings.approvalPolicies, null);
      }
      const updated = await ctx.store.updateProject(access.project.id, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
        ...(input.targetDate !== undefined ? { targetDate: input.targetDate } : {}),
        ...(input.budgetMinor !== undefined ? { budgetMinor: input.budgetMinor } : {}),
        ...(input.externalIntegrationsEnabled !== undefined ? { externalIntegrationsEnabled: input.externalIntegrationsEnabled } : {}),
        ...(input.settings !== undefined
          ? {
              settings: {
                aiEnabled: input.settings.aiEnabled ?? access.project.settings.aiEnabled,
                reminderHoursBeforeExpiry:
                  input.settings.reminderHoursBeforeExpiry ?? access.project.settings.reminderHoursBeforeExpiry,
                approvalPolicies:
                  input.settings.approvalPolicies ?? access.project.settings.approvalPolicies ?? [],
                // Tri-state: an explicit null resets to org-inherit, so test
                // presence, not nullishness.
                stepUp: {
                  otp:
                    input.settings.stepUp && "otp" in input.settings.stepUp
                      ? (input.settings.stepUp.otp ?? null)
                      : (access.project.settings.stepUp?.otp ?? null),
                  typedName:
                    input.settings.stepUp && "typedName" in input.settings.stepUp
                      ? (input.settings.stepUp.typedName ?? null)
                      : (access.project.settings.stepUp?.typedName ?? null),
                },
                // Explicit null disables; absence keeps the current value.
                deemedAcceptanceDays:
                  input.settings && "deemedAcceptanceDays" in input.settings
                    ? (input.settings.deemedAcceptanceDays ?? null)
                    : (access.project.settings.deemedAcceptanceDays ?? null),
                // Explicit null reverts to org-inherit; absence keeps current.
                defaultLocale:
                  input.settings && "defaultLocale" in input.settings
                    ? (input.settings.defaultLocale ?? null)
                    : (access.project.settings.defaultLocale ?? null),
                escalation: {
                  afterHours:
                    input.settings?.escalation && "afterHours" in input.settings.escalation
                      ? (input.settings.escalation.afterHours ?? null)
                      : (access.project.settings.escalation?.afterHours ?? null),
                  target:
                    input.settings?.escalation?.target ??
                    access.project.settings.escalation?.target ??
                    "AGENCY_LEAD",
                },
              },
            }
          : {}),
      });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "project.updated",
        targetType: "PROJECT",
        targetId: access.project.id,
        before: { status: access.project.status, name: access.project.name },
        after: { status: updated.status, name: updated.name },
      });
      res.json(updated);
    }),
  );

  // ----- Project members -----
  router.get(
    "/:id/members",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateQuery(ListQuerySchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const q = (req as ApiRequest).validatedQuery as { cursor?: string; limit: number };
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "project.view");
      const members = await ctx.store.listProjectMembers(access.project.id);
      const users = await Promise.all(members.map((m) => ctx.store.findUserById(m.userId)));
      res.json(paginateList(members.map((m, i) => ({ ...m, user: users[i] ? publicUser(users[i]) : null })), q));
    }),
  );

  router.post(
    "/:id/members",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(AddProjectMemberSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof AddProjectMemberSchema>;
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "project.members.manage");
      const target = input.userId
        ? await ctx.store.findUserById(input.userId)
        : input.email
          ? await ctx.store.findUserByEmail(input.email)
          : null;
      if (!target) throw DomainError.unprocessable("User not found. Invite them to the organization first.");
      const orgMembership = await ctx.store.findMembership(access.org.id, target.id);
      if (!orgMembership) throw DomainError.unprocessable("User is not an organization member. Invite them first.");
      const member = await ctx.store.upsertProjectMember(access.project.id, target.id, input.role);
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "project.member_added",
        targetType: "PROJECT_MEMBER",
        targetId: member.id,
        after: { userId: target.id, role: input.role },
      });
      res.status(201).json({ ...member, user: publicUser(target) });
    }),
  );

  router.patch(
    "/:id/members/:userId",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1), userId: z.string().min(1) })),
    validateBody(UpdateProjectMemberSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof UpdateProjectMemberSchema>;
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "project.members.manage");
      const existing = await ctx.store.findProjectMember(access.project.id, req.params.userId as string);
      if (!existing) throw DomainError.notFound("Project membership not found");
      const updated = await ctx.store.upsertProjectMember(access.project.id, existing.userId, input.role);
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "project.member_role_changed",
        targetType: "PROJECT_MEMBER",
        targetId: updated.id,
        before: { role: existing.role },
        after: { role: updated.role },
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
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "project.members.manage");
      const existing = await ctx.store.findProjectMember(access.project.id, req.params.userId as string);
      if (!existing) throw DomainError.notFound("Project membership not found");
      await ctx.store.deleteProjectMember(access.project.id, existing.userId);
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "project.member_removed",
        targetType: "PROJECT_MEMBER",
        targetId: existing.id,
        before: { role: existing.role, userId: existing.userId },
      });
      res.json({ ok: true });
    }),
  );

  return router;
}

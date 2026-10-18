import { Router } from "express";
import { z } from "zod";
import { RecordActualsSchema } from "@scopelock/contracts";
import { actualsDelta, DomainError, rankComparables } from "@scopelock/domain";
import type { AppContext } from "../app-context.js";
import { asyncHandler } from "../http/errors.js";
import { authenticate, requireAuth } from "../http/auth.js";
import { requireAction, requireProjectAccess } from "../http/access.js";
import { validateBody, validateParams, validateQuery } from "../http/validate.js";
import type { ApiRequest } from "../http/types.js";
import { audit } from "../lib/audit.js";

async function accessibleProjectIds(
  ctx: AppContext,
  userId: string,
  orgId: string,
  orgRole: string,
): Promise<string[]> {
  const all = await ctx.store.listProjects(orgId);
  if (orgRole === "OWNER" || orgRole === "ADMIN") return all.map((p) => p.id);
  const mine = new Set(await ctx.store.listProjectIdsForUser(userId));
  return all.map((p) => p.id).filter((id) => mine.has(id));
}

export function actualsRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use(authenticate(ctx.store));

  // Record actuals on an implemented change (staff estimating permission).
  router.patch(
    "/change-requests/:id/impact/actuals",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(RecordActualsSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof RecordActualsSchema>;
      const change = await ctx.store.findChangeById(req.params.id as string);
      if (!change) throw DomainError.notFound("Change request not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, change.projectId);
      requireAction(access.access, "change.estimate");
      if (change.status !== "IMPLEMENTED") {
        throw DomainError.unprocessable("Actuals can only be recorded on implemented changes");
      }
      const latest = await ctx.store.findLatestImpact(change.id);
      if (!latest) throw DomainError.unprocessable("Record an impact assessment before recording actuals");
      const updated = await ctx.store.recordActuals(change.id, {
        actualEffortDays: input.actualEffortDays ?? null,
        actualPriceMinor: input.actualPriceMinor ?? null,
        actualNotes: input.actualNotes ?? null,
      });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "change.actuals_recorded",
        targetType: "CHANGE",
        targetId: change.id,
        after: {
          actualEffortDays: updated.actualEffortDays,
          actualPriceMinor: updated.actualPriceMinor,
        },
      });
      res.json({
        actualEffortDays: updated.actualEffortDays,
        actualPriceMinor: updated.actualPriceMinor,
        actualCurrency: updated.currency,
        actualNotes: updated.actualNotes,
      });
    }),
  );

  // Price suggestions: ranked comparable approved changes with their real
  // approved prices. Same currency only — never converted.
  router.get(
    "/change-requests/:id/price-suggestions",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateQuery(z.object({ limit: z.coerce.number().int().min(1).max(10).default(5) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const q = (req as ApiRequest).validatedQuery as { limit: number };
      const change = await ctx.store.findChangeById(req.params.id as string);
      if (!change) throw DomainError.notFound("Change request not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, change.projectId);
      requireAction(access.access, "project.view");

      const projectIds = await accessibleProjectIds(ctx, auth.user.id, access.org.id, access.membership.role);
      const priced: Array<{
        changeId: string;
        changeNumber: string;
        title: string;
        description: string;
        priceMinor: number;
        effortDays: number | null;
        decidedAt: string;
        projectId: string;
      }> = [];
      for (const pid of projectIds) {
        const project = await ctx.store.findProjectById(pid);
        if (!project || project.currency !== access.project.currency) continue;
        const changes = await ctx.store.listChanges(pid, { status: ["APPROVED", "IMPLEMENTED"] });
        for (const c of changes) {
          if (c.id === change.id || !c.decidedAt) continue;
          const impact = await ctx.store.findLatestImpact(c.id);
          if (!impact || impact.priceMinor === null) continue;
          priced.push({
            changeId: c.id,
            changeNumber: c.number,
            title: c.title,
            description: c.description,
            priceMinor: impact.priceMinor,
            effortDays: impact.effortDays,
            decidedAt: c.decidedAt,
            projectId: pid,
          });
        }
      }
      const ranked = rankComparables(
        change.title,
        change.description,
        priced.map((p) => ({ changeId: p.changeId, title: p.title, description: p.description })),
        q.limit,
      );
      const byId = new Map(priced.map((p) => [p.changeId, p]));
      res.json({
        changeId: change.id,
        currency: access.project.currency,
        data: ranked.map((r) => {
          const p = byId.get(r.changeId) as (typeof priced)[number];
          return {
            changeId: p.changeId,
            changeNumber: p.changeNumber,
            title: p.title,
            approvedPriceMinor: p.priceMinor,
            currency: access.project.currency,
            effortDays: p.effortDays,
            decidedAt: p.decidedAt,
            link: `/projects/${p.projectId}/changes/${p.changeId}`,
            sharedTerms: r.sharedTerms,
          };
        }),
      });
    }),
  );

  // Estimate-vs-actual report over implemented changes.
  router.get(
    "/projects/:id/estimate-vs-actual",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "project.view");

      const changes = await ctx.store.listChanges(access.project.id, { status: ["IMPLEMENTED"] });
      const rows = [];
      for (const c of changes) {
        const impact = await ctx.store.findLatestImpact(c.id);
        if (!impact) continue;
        const d = actualsDelta(impact.priceMinor, impact.actualPriceMinor, impact.effortDays, impact.actualEffortDays);
        rows.push({
          changeId: c.id,
          changeNumber: c.number,
          title: c.title,
          ...d,
          link: `/projects/${access.project.id}/changes/${c.id}`,
        });
      }
      // Totals cover the comparable set only (rows with both sides present).
      const comparable = rows.filter((r) => r.estimateMinor !== null && r.actualMinor !== null);
      const estimateMinor = comparable.reduce((s, r) => s + (r.estimateMinor as number), 0);
      const actualMinor = comparable.reduce((s, r) => s + (r.actualMinor as number), 0);
      res.json({
        projectId: access.project.id,
        currency: access.project.currency,
        data: rows,
        totals: {
          estimateMinor,
          actualMinor,
          varianceMinor: actualMinor - estimateMinor,
          rowsWithActuals: rows.filter((r) => r.actualMinor !== null || r.actualDays !== null).length,
          rowsTotal: rows.length,
        },
      });
    }),
  );

  return router;
}

import { Router } from "express";
import { z } from "zod";
import { DomainError, computeContractLedger, computeOrgRollup, type LedgerChangeInput, type ProjectLedgerSummary } from "@scopelock/domain";
import type { AppContext } from "../app-context.js";
import { asyncHandler } from "../http/errors.js";
import { authenticate, requireAuth } from "../http/auth.js";
import { requireAction, requireOrgAccess, requireProjectAccess } from "../http/access.js";
import { validateParams } from "../http/validate.js";
import type { ApiRequest } from "../http/types.js";
import type { Project, Store } from "../store/index.js";

/** Assemble one project's ledger from raw records. Pure math lives in domain/ledger. */
export async function buildProjectLedger(
  store: Store,
  project: Project,
): Promise<{ ledger: ReturnType<typeof computeContractLedger>; summary: ProjectLedgerSummary }> {
  const [changes, versions] = await Promise.all([
    store.listChanges(project.id),
    store.listProjectScopeVersions(project.id),
  ]);
  const inputs: LedgerChangeInput[] = [];
  for (const c of changes) {
    if (c.status !== "APPROVED" && c.status !== "IMPLEMENTED" && c.status !== "PENDING_APPROVAL") continue;
    const impact = await store.findLatestImpact(c.id);
    inputs.push({
      changeId: c.id,
      number: c.number,
      title: c.title,
      status: c.status,
      priceMinor: impact?.priceMinor ?? null,
      currency: impact?.currency ?? null,
      effortDays: impact?.effortDays ?? null,
      decidedAt: c.decidedAt,
      amendmentVersionId: c.amendmentVersionId,
    });
  }
  const ledger = computeContractLedger({
    currency: project.currency,
    baselineMinor: project.budgetMinor,
    changes: inputs,
    versions: versions.map((v) => ({
      scopeVersionId: v.id,
      sequence: v.sequence,
      status: v.status,
      title: v.title,
    })),
  });
  return {
    ledger,
    summary: {
      projectId: project.id,
      name: project.name,
      currency: project.currency,
      baselineMinor: ledger.baselineMinor,
      currentMinor: ledger.currentMinor,
      pendingExposureMinor: ledger.pendingExposureMinor,
      absorbedCount: ledger.absorbedCount,
    },
  };
}

export function ledgerRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use(authenticate(ctx.store));

  router.get(
    "/projects/:id/contract",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "project.view");
      const { ledger } = await buildProjectLedger(ctx.store, access.project);
      res.json(ledger);
    }),
  );

  // Org rollup over the requester's VISIBLE projects only: members never learn
  // totals for projects they cannot open.
  router.get(
    "/organizations/:id/contract",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction({ orgRole: membership.role, projectRole: null }, "org.view");
      const isOperator = membership.role === "OWNER" || membership.role === "ADMIN";
      const all = await ctx.store.listProjects(org.id);
      const memberProjectIds = isOperator ? null : new Set(await ctx.store.listProjectIdsForUser(auth.user.id));
      const visible = all.filter((p) => memberProjectIds === null || memberProjectIds.has(p.id));
      const summaries: ProjectLedgerSummary[] = [];
      for (const p of visible) {
        summaries.push((await buildProjectLedger(ctx.store, p)).summary);
      }
      res.json(computeOrgRollup(summaries));
    }),
  );

  return router;
}

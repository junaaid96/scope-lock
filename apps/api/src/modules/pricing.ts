import { Router } from "express";
import { z } from "zod";
import {
  CreateEstimateTemplateSchema,
  CreateRateCardSchema,
  ListQuerySchema,
  UpdateEstimateTemplateSchema,
  UpdateRateCardSchema,
} from "@scopelock/contracts";
import { DomainError } from "@scopelock/domain";
import type { AppContext } from "../app-context.js";
import { asyncHandler } from "../http/errors.js";
import { authenticate, requireAuth } from "../http/auth.js";
import { requireAction, requireOrgAccess } from "../http/access.js";
import { validateBody, validateParams, validateQuery } from "../http/validate.js";
import { paginateList } from "../http/pagination.js";
import type { ApiRequest } from "../http/types.js";
import { audit } from "../lib/audit.js";

function assertUniqueRoles(rates: Array<{ role: string }>): void {
  const seen = new Set<string>();
  for (const r of rates) {
    if (seen.has(r.role)) throw DomainError.unprocessable(`Duplicate role on this card: "${r.role}"`);
    seen.add(r.role);
  }
}

export function pricingRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use(authenticate(ctx.store));

  // ----- Rate cards -----
  router.get(
    "/organizations/:id/rate-cards",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateQuery(ListQuerySchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const q = (req as ApiRequest).validatedQuery as { cursor?: string; limit: number };
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction({ orgRole: membership.role, projectRole: null }, "ratecard.view");
      res.json(paginateList(await ctx.store.listRateCards(org.id), q));
    }),
  );

  router.post(
    "/organizations/:id/rate-cards",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(CreateRateCardSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof CreateRateCardSchema>;
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction({ orgRole: membership.role, projectRole: null }, "ratecard.manage");
      assertUniqueRoles(input.rates);
      const card = await ctx.store.transaction(async (tx) => {
        if (input.isDefault) {
          for (const other of await tx.listRateCards(org.id)) {
            if (other.isDefault) await tx.updateRateCard(other.id, { isDefault: false });
          }
        }
        return tx.createRateCard({
          organizationId: org.id,
          name: input.name,
          currency: input.currency,
          isDefault: input.isDefault,
          createdBy: auth.user.id,
          rates: input.rates,
        });
      });
      await audit(ctx.store, {
        organizationId: org.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "ratecard.created",
        targetType: "RATE_CARD",
        targetId: card.id,
        after: { name: card.name, currency: card.currency, roles: card.rates.length },
      });
      res.status(201).json(card);
    }),
  );

  router.get(
    "/rate-cards/:id",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const card = await ctx.store.findRateCardById(req.params.id as string);
      if (!card) throw DomainError.notFound("Rate card not found");
      const { membership } = await requireOrgAccess(ctx.store, auth.user.id, card.organizationId);
      requireAction({ orgRole: membership.role, projectRole: null }, "ratecard.view");
      res.json(card);
    }),
  );

  router.patch(
    "/rate-cards/:id",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(UpdateRateCardSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof UpdateRateCardSchema>;
      const card = await ctx.store.findRateCardById(req.params.id as string);
      if (!card) throw DomainError.notFound("Rate card not found");
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, card.organizationId);
      requireAction({ orgRole: membership.role, projectRole: null }, "ratecard.manage");
      if (input.rates) assertUniqueRoles(input.rates);
      const touchesMoney = input.rates !== undefined || input.currency !== undefined;
      if (touchesMoney && (await ctx.store.countImpactsByRateCard(card.id)) > 0) {
        throw DomainError.conflict("This card already priced impacts. Create a new card instead of changing its rates or currency.", {
          code: "RATE_CARD_REFERENCED",
        });
      }
      const updated = await ctx.store.transaction(async (tx) => {
        if (input.isDefault === true) {
          for (const other of await tx.listRateCards(org.id)) {
            if (other.id !== card.id && other.isDefault) await tx.updateRateCard(other.id, { isDefault: false });
          }
        }
        return tx.updateRateCard(card.id, {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
          ...(input.rates !== undefined ? { rates: input.rates } : {}),
        });
      });
      await audit(ctx.store, {
        organizationId: org.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "ratecard.updated",
        targetType: "RATE_CARD",
        targetId: card.id,
        after: { name: updated.name },
      });
      res.json(updated);
    }),
  );

  router.delete(
    "/rate-cards/:id",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const card = await ctx.store.findRateCardById(req.params.id as string);
      if (!card) throw DomainError.notFound("Rate card not found");
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, card.organizationId);
      requireAction({ orgRole: membership.role, projectRole: null }, "ratecard.manage");
      if ((await ctx.store.countImpactsByRateCard(card.id)) > 0) {
        throw DomainError.conflict("This card already priced impacts and cannot be deleted.", { code: "RATE_CARD_REFERENCED" });
      }
      await ctx.store.deleteRateCard(card.id);
      await audit(ctx.store, {
        organizationId: org.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "ratecard.deleted",
        targetType: "RATE_CARD",
        targetId: card.id,
        before: { name: card.name },
      });
      res.json({ ok: true });
    }),
  );

  // ----- Estimate templates (snapshots survive template edits/deletes) -----
  router.get(
    "/organizations/:id/estimate-templates",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateQuery(ListQuerySchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const q = (req as ApiRequest).validatedQuery as { cursor?: string; limit: number };
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction({ orgRole: membership.role, projectRole: null }, "ratecard.view");
      res.json(paginateList(await ctx.store.listEstimateTemplates(org.id), q));
    }),
  );

  router.post(
    "/organizations/:id/estimate-templates",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(CreateEstimateTemplateSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof CreateEstimateTemplateSchema>;
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction({ orgRole: membership.role, projectRole: null }, "ratecard.manage");
      const template = await ctx.store.createEstimateTemplate({
        organizationId: org.id,
        name: input.name,
        items: input.items,
        contingencyPct: input.contingencyPct,
        taxPct: input.taxPct ?? null,
        createdBy: auth.user.id,
      });
      await audit(ctx.store, {
        organizationId: org.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "template.created",
        targetType: "ESTIMATE_TEMPLATE",
        targetId: template.id,
        after: { name: template.name },
      });
      res.status(201).json(template);
    }),
  );

  router.get(
    "/estimate-templates/:id",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const template = await ctx.store.findEstimateTemplateById(req.params.id as string);
      if (!template) throw DomainError.notFound("Estimate template not found");
      const { membership } = await requireOrgAccess(ctx.store, auth.user.id, template.organizationId);
      requireAction({ orgRole: membership.role, projectRole: null }, "ratecard.view");
      res.json(template);
    }),
  );

  router.patch(
    "/estimate-templates/:id",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(UpdateEstimateTemplateSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof UpdateEstimateTemplateSchema>;
      const template = await ctx.store.findEstimateTemplateById(req.params.id as string);
      if (!template) throw DomainError.notFound("Estimate template not found");
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, template.organizationId);
      requireAction({ orgRole: membership.role, projectRole: null }, "ratecard.manage");
      const updated = await ctx.store.updateEstimateTemplate(template.id, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.items !== undefined ? { items: input.items } : {}),
        ...(input.contingencyPct !== undefined ? { contingencyPct: input.contingencyPct } : {}),
        ...(input.taxPct !== undefined ? { taxPct: input.taxPct } : {}),
      });
      await audit(ctx.store, {
        organizationId: org.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "template.updated",
        targetType: "ESTIMATE_TEMPLATE",
        targetId: template.id,
        after: { name: updated.name },
      });
      res.json(updated);
    }),
  );

  router.delete(
    "/estimate-templates/:id",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const template = await ctx.store.findEstimateTemplateById(req.params.id as string);
      if (!template) throw DomainError.notFound("Estimate template not found");
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, template.organizationId);
      requireAction({ orgRole: membership.role, projectRole: null }, "ratecard.manage");
      await ctx.store.deleteEstimateTemplate(template.id);
      await audit(ctx.store, {
        organizationId: org.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "template.deleted",
        targetType: "ESTIMATE_TEMPLATE",
        targetId: template.id,
        before: { name: template.name },
      });
      res.json({ ok: true });
    }),
  );

  return router;
}

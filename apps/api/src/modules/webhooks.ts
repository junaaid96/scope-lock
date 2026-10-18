import { Router } from "express";
import { z } from "zod";
import {
  CreateWebhookSchema,
  ListQuerySchema,
  UpdateWebhookSchema,
  WebhookDeliveryViewSchema,
  WebhookViewSchema,
} from "@scopelock/contracts";
import { DomainError, newToken } from "@scopelock/domain";
import type { AppContext } from "../app-context.js";
import { asyncHandler } from "../http/errors.js";
import { authenticate, requireAuth } from "../http/auth.js";
import { requireAction, requireOrgAccess } from "../http/access.js";
import { idempotency } from "../http/idempotency.js";
import { validateBody, validateParams, validateQuery } from "../http/validate.js";
import type { ApiRequest } from "../http/types.js";
import { audit } from "../lib/audit.js";
import { sealSecret } from "../lib/mfa.js";
import { assertSafeWebhookUrl, webhookSsrfPolicy } from "../lib/ssrf.js";
import type { WebhookDelivery, WebhookSubscription } from "../store/index.js";

const OrgParam = z.object({ id: z.string().min(1) });
const HookParam = z.object({ id: z.string().min(1), hookId: z.string().min(1) });
const DeliveryParam = z.object({ id: z.string().min(1), hookId: z.string().min(1), deliveryId: z.string().min(1) });

/** Explicitly picked fields: sealed secrets never leave the server. */
function safeWebhook(sub: WebhookSubscription): z.infer<typeof WebhookViewSchema> {
  return WebhookViewSchema.parse({
    id: sub.id,
    organizationId: sub.organizationId,
    url: sub.url,
    events: sub.events,
    enabled: sub.enabled,
    createdAt: sub.createdAt,
    updatedAt: sub.updatedAt,
  });
}

function safeDelivery(delivery: WebhookDelivery): z.infer<typeof WebhookDeliveryViewSchema> {
  return WebhookDeliveryViewSchema.parse({
    id: delivery.id,
    subscriptionId: delivery.subscriptionId,
    event: delivery.event,
    status: delivery.status,
    attempts: delivery.attempts,
    responseStatus: delivery.responseStatus,
    lastError: delivery.lastError,
    createdAt: delivery.createdAt,
    updatedAt: delivery.updatedAt,
  });
}

async function orgHook(ctx: AppContext, orgId: string, hookId: string): Promise<WebhookSubscription> {
  const sub = await ctx.store.findWebhookById(hookId);
  if (!sub || sub.organizationId !== orgId) throw DomainError.notFound("Webhook not found");
  return sub;
}

export function webhookRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use(authenticate(ctx.store));

  router.get(
    "/:id/webhooks",
    requireAuth,
    validateParams(OrgParam),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction({ orgRole: membership.role, projectRole: null }, "org.manage");
      const subs = await ctx.store.listWebhooks(org.id);
      res.json(subs.map(safeWebhook));
    }),
  );

  router.post(
    "/:id/webhooks",
    requireAuth,
    idempotency(ctx.store, "webhook-create"),
    validateParams(OrgParam),
    validateBody(CreateWebhookSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof CreateWebhookSchema>;
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction({ orgRole: membership.role, projectRole: null }, "org.manage");
      await assertSafeWebhookUrl(input.url, webhookSsrfPolicy(ctx.env.NODE_ENV));
      const secret = `whsec_${newToken(24)}`;
      const created = await ctx.store.createWebhook({
        organizationId: org.id,
        url: input.url,
        events: [...new Set(input.events)],
        secretSealed: sealSecret(ctx.env.AUTH_SECRET, secret),
        enabled: input.enabled,
      });
      await audit(ctx.store, {
        organizationId: org.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "webhook.created",
        targetType: "WEBHOOK",
        targetId: created.id,
        after: { url: created.url, events: created.events },
      });
      // The signing secret is shown exactly once, here.
      res.status(201).json({ webhook: safeWebhook(created), secret });
    }),
  );

  router.patch(
    "/:id/webhooks/:hookId",
    requireAuth,
    validateParams(HookParam),
    validateBody(UpdateWebhookSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof UpdateWebhookSchema>;
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction({ orgRole: membership.role, projectRole: null }, "org.manage");
      const sub = await orgHook(ctx, org.id, req.params.hookId as string);
      if (input.url !== undefined) await assertSafeWebhookUrl(input.url, webhookSsrfPolicy(ctx.env.NODE_ENV));
      const updated = await ctx.store.updateWebhook(sub.id, {
        ...(input.url !== undefined ? { url: input.url } : {}),
        ...(input.events !== undefined ? { events: [...new Set(input.events)] } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      });
      await audit(ctx.store, {
        organizationId: org.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "webhook.updated",
        targetType: "WEBHOOK",
        targetId: updated.id,
        before: { url: sub.url, events: sub.events, enabled: sub.enabled },
        after: { url: updated.url, events: updated.events, enabled: updated.enabled },
      });
      res.json(safeWebhook(updated));
    }),
  );

  router.delete(
    "/:id/webhooks/:hookId",
    requireAuth,
    validateParams(HookParam),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction({ orgRole: membership.role, projectRole: null }, "org.manage");
      const sub = await orgHook(ctx, org.id, req.params.hookId as string);
      await ctx.store.deleteWebhook(sub.id);
      await audit(ctx.store, {
        organizationId: org.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "webhook.deleted",
        targetType: "WEBHOOK",
        targetId: sub.id,
        before: { url: sub.url },
      });
      res.status(204).end();
    }),
  );

  router.post(
    "/:id/webhooks/:hookId/rotate-secret",
    requireAuth,
    idempotency(ctx.store, "webhook-rotate"),
    validateParams(HookParam),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction({ orgRole: membership.role, projectRole: null }, "org.manage");
      const sub = await orgHook(ctx, org.id, req.params.hookId as string);
      const secret = `whsec_${newToken(24)}`;
      const updated = await ctx.store.updateWebhook(sub.id, { secretSealed: sealSecret(ctx.env.AUTH_SECRET, secret) });
      await audit(ctx.store, {
        organizationId: org.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "webhook.secret_rotated",
        targetType: "WEBHOOK",
        targetId: updated.id,
      });
      res.status(201).json({ webhook: safeWebhook(updated), secret });
    }),
  );

  router.get(
    "/:id/webhooks/:hookId/deliveries",
    requireAuth,
    validateParams(HookParam),
    validateQuery(ListQuerySchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction({ orgRole: membership.role, projectRole: null }, "org.manage");
      const sub = await orgHook(ctx, org.id, req.params.hookId as string);
      const q = (req as ApiRequest).validatedQuery as { cursor?: string; limit: number };
      const page = await ctx.store.listWebhookDeliveries(sub.id, q);
      res.json({ ...page, items: page.items.map(safeDelivery) });
    }),
  );

  router.post(
    "/:id/webhooks/:hookId/deliveries/:deliveryId/replay",
    requireAuth,
    idempotency(ctx.store, "webhook-replay"),
    validateParams(DeliveryParam),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction({ orgRole: membership.role, projectRole: null }, "org.manage");
      const sub = await orgHook(ctx, org.id, req.params.hookId as string);
      const delivery = await ctx.store.findWebhookDeliveryById(req.params.deliveryId as string);
      if (!delivery || delivery.subscriptionId !== sub.id) throw DomainError.notFound("Delivery not found");
      const outbox = await ctx.store.enqueueOutbox({
        type: "WEBHOOK",
        payload: { subscriptionId: sub.id, body: delivery.requestBody },
        idempotencyKey: `replay:${delivery.id}:${Date.now()}`,
      });
      const updated = await ctx.store.updateWebhookDelivery(delivery.id, {
        outboxEventId: outbox.id,
        status: "PENDING",
        responseStatus: null,
        lastError: null,
      });
      await audit(ctx.store, {
        organizationId: org.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "webhook.replayed",
        targetType: "WEBHOOK_DELIVERY",
        targetId: delivery.id,
        after: { subscriptionId: sub.id, event: delivery.event },
      });
      res.status(202).json(safeDelivery(updated));
    }),
  );

  return router;
}

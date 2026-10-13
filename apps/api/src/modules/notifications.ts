import { Router } from "express";
import { z } from "zod";
import { MarkNotificationReadSchema } from "@scopelock/contracts";
import { DomainError } from "@scopelock/domain";
import type { AppContext } from "../app-context.js";
import { asyncHandler } from "../http/errors.js";
import { authenticate, requireAuth } from "../http/auth.js";
import { requireAction, requireProjectAccess } from "../http/access.js";
import { validateBody, validateParams, validateQuery } from "../http/validate.js";
import type { ApiRequest } from "../http/types.js";
import { nowIso } from "../store/index.js";

export function notificationRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use(authenticate(ctx.store));

  router.get(
    "/notifications",
    requireAuth,
    validateQuery(z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(25) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const q = (req as ApiRequest).validatedQuery as { cursor?: string; limit: number };
      try {
        const result = await ctx.store.listNotifications(auth.user.id, { cursor: q.cursor, limit: q.limit });
        res.json({ data: result.items, pagination: { nextCursor: result.nextCursor } });
      } catch {
        throw DomainError.badRequest("Invalid pagination cursor");
      }
    }),
  );

  router.post(
    "/notifications/:id/read",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(MarkNotificationReadSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof MarkNotificationReadSchema>;
      const updated = await ctx.store.markNotification(
        req.params.id as string,
        auth.user.id,
        input.read ? nowIso() : null,
      );
      if (!updated) throw DomainError.notFound("Notification not found");
      res.json(updated);
    }),
  );

  // Short-lived project channel token (Ably capability or local HMAC) — issued
  // only after the project authorization check. Clients use it for refresh hints.
  router.get(
    "/projects/:id/realtime/token",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "project.view");
      const channel = `project:${access.project.id}`;
      const issued = await ctx.realtime.createChannelToken(channel, auth.user.id);
      res.json({ channel, driver: ctx.realtime.name, ...issued });
    }),
  );

  // Polling fallback: recent project events since a timestamp. Correct with or
  // without realtime — the database remains authoritative.
  router.get(
    "/projects/:id/events",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateQuery(z.object({ since: z.string().datetime({ offset: true }).optional() }).partial()),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const q = (req as ApiRequest).validatedQuery as { since?: string };
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "activity.view");
      const page = await ctx.store.listAuditEvents({ projectId: access.project.id, limit: 50 });
      const since = q.since ? Date.parse(q.since) : 0;
      res.json({
        serverTime: nowIso(),
        driver: ctx.realtime.name,
        events: page.items
          .filter((e) => Date.parse(e.createdAt) > since)
          .map((e) => ({
            id: e.id,
            action: e.action,
            targetType: e.targetType,
            targetId: e.targetId,
            createdAt: e.createdAt,
          })),
      });
    }),
  );

  return router;
}

import { Router } from "express";
import { z } from "zod";
import { CreateExternalConnectionSchema, CreateExternalLinkSchema, ListQuerySchema, UpdateExternalConnectionSchema } from "@scopelock/contracts";
import { DomainError, newToken } from "@scopelock/domain";
import type { AppContext } from "../app-context.js";
import { asyncHandler } from "../http/errors.js";
import { authenticate, requireAuth } from "../http/auth.js";
import { requireAction, requireProjectAccess } from "../http/access.js";
import { validateBody, validateParams, validateQuery } from "../http/validate.js";
import { paginateList } from "../http/pagination.js";
import type { ApiRequest } from "../http/types.js";
import { audit } from "../lib/audit.js";
import { sealSecret } from "../lib/mfa.js";
import type { ExternalConnection } from "../store/types.js";

/** Explicitly picked fields: sealed secrets never leave the server. */
function safeConnection(c: ExternalConnection): Omit<ExternalConnection, "secretSealed"> {
  const { secretSealed: _sealed, ...rest } = c;
  void _sealed;
  return rest;
}

export function externalRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use(authenticate(ctx.store));

  router.get(
    "/projects/:id/external-links",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateQuery(ListQuerySchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const q = (req as ApiRequest).validatedQuery as { cursor?: string; limit: number };
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "project.view");
      res.json(paginateList(await ctx.store.listExternalLinks(access.project.id), q));
    }),
  );

  router.post(
    "/projects/:id/external-links",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(CreateExternalLinkSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof CreateExternalLinkSchema>;
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "external.manage");
      if (!access.project.externalIntegrationsEnabled) {
        throw DomainError.unprocessable("External integrations are not enabled for this project (opt-in in project settings)");
      }
      const change = await ctx.store.findChangeById(input.changeRequestId);
      if (!change || change.projectId !== access.project.id) throw DomainError.notFound("Change not found");
      try {
        const link = await ctx.store.createExternalLink({
          projectId: access.project.id,
          changeRequestId: change.id,
          provider: input.provider,
          externalId: input.externalId,
          url: input.url ?? null,
          createdBy: auth.user.id,
        });
        await audit(ctx.store, {
          organizationId: access.org.id,
          projectId: access.project.id,
          actorId: auth.user.id,
          actorEmail: auth.user.email,
          action: "external.linked",
          targetType: "CHANGE",
          targetId: change.id,
          after: { provider: input.provider, externalId: input.externalId },
        });
        res.status(201).json(link);
      } catch (err) {
        if (err instanceof DomainError) throw err;
        throw DomainError.conflict("This external item is already linked");
      }
    }),
  );

  router.delete(
    "/external-links/:id",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const link = await ctx.store.findExternalLinkById(req.params.id as string);
      if (!link) throw DomainError.notFound("External link not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, link.projectId);
      requireAction(access.access, "external.manage");
      await ctx.store.deleteExternalLink(req.params.id as string);
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "external.unlinked",
        targetType: "EXTERNAL_LINK",
        targetId: req.params.id as string,
      });
      res.json({ ok: true });
    }),
  );

  // ----- Provider connections (webhook intake per project) -----

  router.get(
    "/projects/:id/external-connections",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "project.view");
      res.json((await ctx.store.listExternalConnections(access.project.id)).map(safeConnection));
    }),
  );

  router.post(
    "/projects/:id/external-connections",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(CreateExternalConnectionSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof CreateExternalConnectionSchema>;
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "external.manage");
      if (!access.project.externalIntegrationsEnabled) {
        throw DomainError.unprocessable("External integrations are not enabled for this project (opt-in in project settings)");
      }
      const secret = `ghsec_${newToken(24)}`;
      try {
        const connection = await ctx.store.createExternalConnection({
          projectId: access.project.id,
          provider: input.provider,
          secretSealed: sealSecret(ctx.env.AUTH_SECRET, secret),
          enabled: input.enabled,
        });
        await audit(ctx.store, {
          organizationId: access.org.id,
          projectId: access.project.id,
          actorId: auth.user.id,
          actorEmail: auth.user.email,
          action: "external.connection.created",
          targetType: "EXTERNAL_CONNECTION",
          targetId: connection.id,
          after: { provider: input.provider },
        });
        res.status(201).json({
          connection: safeConnection(connection),
          secret,
          webhookUrl: `${ctx.env.API_URL}/api/v1/webhooks/github/${connection.id}`,
        });
      } catch (err) {
        if (err instanceof DomainError) throw err;
        throw DomainError.conflict("This project already has a connection for this provider");
      }
    }),
  );

  router.patch(
    "/projects/:id/external-connections/:connectionId",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1), connectionId: z.string().min(1) })),
    validateBody(UpdateExternalConnectionSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof UpdateExternalConnectionSchema>;
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "external.manage");
      const connection = await ctx.store.findExternalConnectionById(req.params.connectionId as string);
      if (!connection || connection.projectId !== access.project.id) throw DomainError.notFound("Connection not found");
      const updated = await ctx.store.updateExternalConnection(connection.id, { enabled: input.enabled });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "external.connection.updated",
        targetType: "EXTERNAL_CONNECTION",
        targetId: connection.id,
        after: { enabled: input.enabled },
      });
      res.json(safeConnection(updated));
    }),
  );

  router.post(
    "/projects/:id/external-connections/:connectionId/rotate-secret",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1), connectionId: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "external.manage");
      const connection = await ctx.store.findExternalConnectionById(req.params.connectionId as string);
      if (!connection || connection.projectId !== access.project.id) throw DomainError.notFound("Connection not found");
      const secret = `ghsec_${newToken(24)}`;
      const updated = await ctx.store.updateExternalConnection(connection.id, { secretSealed: sealSecret(ctx.env.AUTH_SECRET, secret) });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "external.connection.rotated",
        targetType: "EXTERNAL_CONNECTION",
        targetId: connection.id,
      });
      res.status(201).json({ connection: safeConnection(updated), secret });
    }),
  );

  router.delete(
    "/projects/:id/external-connections/:connectionId",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1), connectionId: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "external.manage");
      const connection = await ctx.store.findExternalConnectionById(req.params.connectionId as string);
      if (!connection || connection.projectId !== access.project.id) throw DomainError.notFound("Connection not found");
      await ctx.store.deleteExternalConnection(connection.id);
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "external.connection.deleted",
        targetType: "EXTERNAL_CONNECTION",
        targetId: connection.id,
      });
      res.json({ ok: true });
    }),
  );

  // ----- Observed external work (identifiers only) -----

  router.get(
    "/projects/:id/external-work",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateQuery(ListQuerySchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const q = (req as ApiRequest).validatedQuery as { cursor?: string; limit: number };
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "project.view");
      // Cursor pagination keys on createdAt; observedAt plays that role here.
      const rows = (await ctx.store.listExternalWorkItems(access.project.id)).map((w) => ({ ...w, createdAt: w.observedAt }));
      const page = paginateList(rows, q);
      res.json({
        data: page.data.map((r) => {
          const { createdAt: _created, ...w } = r;
          void _created;
          return w;
        }),
        pagination: page.pagination,
      });
    }),
  );

  return router;
}

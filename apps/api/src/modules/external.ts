import { Router } from "express";
import { z } from "zod";
import { CreateExternalLinkSchema, ListQuerySchema } from "@scopelock/contracts";
import { DomainError } from "@scopelock/domain";
import type { AppContext } from "../app-context.js";
import { asyncHandler } from "../http/errors.js";
import { authenticate, requireAuth } from "../http/auth.js";
import { requireAction, requireProjectAccess } from "../http/access.js";
import { validateBody, validateParams, validateQuery } from "../http/validate.js";
import { paginateList } from "../http/pagination.js";
import type { ApiRequest } from "../http/types.js";
import { audit } from "../lib/audit.js";

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

  return router;
}

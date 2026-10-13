import { Router } from "express";
import { z } from "zod";
import { CreateClientSchema, ListQuerySchema, UpdateClientSchema } from "@scopelock/contracts";
import { DomainError } from "@scopelock/domain";
import type { AppContext } from "../app-context.js";
import { asyncHandler } from "../http/errors.js";
import { authenticate, requireAuth } from "../http/auth.js";
import { requireAction, requireOrgAccess } from "../http/access.js";
import { validateBody, validateParams, validateQuery } from "../http/validate.js";
import { paginateList } from "../http/pagination.js";
import type { ApiRequest } from "../http/types.js";
import { audit } from "../lib/audit.js";
import { nowIso } from "../store/index.js";

export function clientRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use(authenticate(ctx.store));

  router.get(
    "/",
    requireAuth,
    validateQuery(ListQuerySchema.merge(z.object({ organizationId: z.string().min(1) }))),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const q = (req as ApiRequest).validatedQuery as { organizationId: string; cursor?: string; limit: number };
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, q.organizationId);
      requireAction({ orgRole: membership.role, projectRole: null }, "client.manage");
      res.json(paginateList(await ctx.store.listClients(org.id), q));
    }),
  );

  router.post(
    "/",
    requireAuth,
    validateBody(CreateClientSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof CreateClientSchema>;
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, input.organizationId);
      requireAction({ orgRole: membership.role, projectRole: null }, "client.manage");
      const client = await ctx.store.createClient({
        organizationId: org.id,
        name: input.name,
        company: input.company ?? null,
        contacts: input.contacts,
        notes: input.notes ?? null,
      });
      await audit(ctx.store, {
        organizationId: org.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "client.created",
        targetType: "CLIENT",
        targetId: client.id,
        after: { name: client.name },
      });
      res.status(201).json(client);
    }),
  );

  router.get(
    "/:id",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const client = await ctx.store.findClientById(req.params.id as string);
      if (!client || client.deletedAt) throw DomainError.notFound("Client not found");
      const { membership } = await requireOrgAccess(ctx.store, auth.user.id, client.organizationId);
      requireAction({ orgRole: membership.role, projectRole: null }, "client.manage");
      res.json(client);
    }),
  );

  router.patch(
    "/:id",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(UpdateClientSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof UpdateClientSchema>;
      const client = await ctx.store.findClientById(req.params.id as string);
      if (!client || client.deletedAt) throw DomainError.notFound("Client not found");
      const { membership } = await requireOrgAccess(ctx.store, auth.user.id, client.organizationId);
      requireAction({ orgRole: membership.role, projectRole: null }, "client.manage");
      const updated = await ctx.store.updateClient(client.id, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.company !== undefined ? { company: input.company ?? null } : {}),
        ...(input.contacts !== undefined ? { contacts: input.contacts } : {}),
        ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
      });
      await audit(ctx.store, {
        organizationId: client.organizationId,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "client.updated",
        targetType: "CLIENT",
        targetId: client.id,
        before: { name: client.name },
        after: { name: updated.name },
      });
      res.json(updated);
    }),
  );

  router.delete(
    "/:id",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const client = await ctx.store.findClientById(req.params.id as string);
      if (!client || client.deletedAt) throw DomainError.notFound("Client not found");
      const { membership } = await requireOrgAccess(ctx.store, auth.user.id, client.organizationId);
      requireAction({ orgRole: membership.role, projectRole: null }, "client.manage");
      const projects = await ctx.store.listProjects(client.organizationId);
      if (projects.some((p) => p.clientId === client.id)) {
        throw DomainError.unprocessable("This client still has projects. Archive or move them first.");
      }
      await ctx.store.updateClient(client.id, { deletedAt: nowIso() });
      await audit(ctx.store, {
        organizationId: client.organizationId,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "client.archived",
        targetType: "CLIENT",
        targetId: client.id,
        before: { name: client.name },
      });
      res.json({ ok: true });
    }),
  );

  return router;
}

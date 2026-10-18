import { Router } from "express";
import { z } from "zod";
import { ApiKeyViewSchema, CreateApiKeySchema } from "@scopelock/contracts";
import { DomainError, apiKeyPrefix, newApiKeySecret, sha256Hex } from "@scopelock/domain";
import type { AppContext } from "../app-context.js";
import { asyncHandler } from "../http/errors.js";
import { authenticate, requireAuth } from "../http/auth.js";
import { requireAction, requireOrgAccess } from "../http/access.js";
import { idempotency } from "../http/idempotency.js";
import { validateBody, validateParams } from "../http/validate.js";
import type { ApiRequest } from "../http/types.js";
import { audit } from "../lib/audit.js";
import { nowIso, type ApiKey } from "../store/index.js";

const OrgParam = z.object({ id: z.string().min(1) });
const KeyParam = z.object({ id: z.string().min(1), keyId: z.string().min(1) });

/** Explicitly picked fields: the secret hash never leaves the server. */
function safeKey(key: ApiKey): z.infer<typeof ApiKeyViewSchema> {
  return ApiKeyViewSchema.parse({
    id: key.id,
    organizationId: key.organizationId,
    name: key.name,
    prefix: key.prefix,
    scopes: key.scopes,
    expiresAt: key.expiresAt,
    lastUsedAt: key.lastUsedAt,
    revokedAt: key.revokedAt,
    createdAt: key.createdAt,
  });
}

export function apiKeyRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use(authenticate(ctx.store));

  router.get(
    "/:id/api-keys",
    requireAuth,
    validateParams(OrgParam),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction({ orgRole: membership.role, projectRole: null }, "org.manage");
      const keys = await ctx.store.listApiKeys(org.id);
      res.json(keys.map(safeKey));
    }),
  );

  router.post(
    "/:id/api-keys",
    requireAuth,
    idempotency(ctx.store, "apikey-create"),
    validateParams(OrgParam),
    validateBody(CreateApiKeySchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof CreateApiKeySchema>;
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction({ orgRole: membership.role, projectRole: null }, "org.manage");
      if (input.expiresAt && Date.parse(input.expiresAt) <= Date.now()) {
        throw DomainError.unprocessable("expiresAt must be in the future");
      }
      const secret = newApiKeySecret();
      const created = await ctx.store.createApiKey({
        organizationId: org.id,
        userId: auth.user.id,
        name: input.name,
        keyHash: sha256Hex(secret),
        prefix: apiKeyPrefix(secret),
        scopes: input.scopes.includes("*") ? ["*"] : [...new Set(input.scopes)],
        expiresAt: input.expiresAt ?? null,
        lastUsedAt: null,
        revokedAt: null,
      });
      await audit(ctx.store, {
        organizationId: org.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "apikey.created",
        targetType: "API_KEY",
        targetId: created.id,
        after: { name: created.name, prefix: created.prefix, scopes: created.scopes },
      });
      // The full secret is shown exactly once, here. It is never stored raw.
      res.status(201).json({ key: safeKey(created), secret });
    }),
  );

  router.post(
    "/:id/api-keys/:keyId/rotate",
    requireAuth,
    idempotency(ctx.store, "apikey-rotate"),
    validateParams(KeyParam),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction({ orgRole: membership.role, projectRole: null }, "org.manage");
      const existing = await ctx.store.findApiKeyById(req.params.keyId as string);
      if (!existing || existing.organizationId !== org.id) throw DomainError.notFound("API key not found");
      if (existing.revokedAt) throw DomainError.conflict("API key is already revoked");
      const secret = newApiKeySecret();
      const now = nowIso();
      const rotated = await ctx.store.transaction(async (tx) => {
        await tx.updateApiKey(existing.id, { revokedAt: now });
        return tx.createApiKey({
          organizationId: org.id,
          userId: auth.user.id,
          name: existing.name,
          keyHash: sha256Hex(secret),
          prefix: apiKeyPrefix(secret),
          scopes: existing.scopes,
          expiresAt: existing.expiresAt,
          lastUsedAt: null,
          revokedAt: null,
        });
      });
      await audit(ctx.store, {
        organizationId: org.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "apikey.rotated",
        targetType: "API_KEY",
        targetId: rotated.id,
        after: { name: rotated.name, prefix: rotated.prefix, rotatedFrom: existing.id },
      });
      res.status(201).json({ key: safeKey(rotated), secret });
    }),
  );

  router.delete(
    "/:id/api-keys/:keyId",
    requireAuth,
    validateParams(KeyParam),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction({ orgRole: membership.role, projectRole: null }, "org.manage");
      const existing = await ctx.store.findApiKeyById(req.params.keyId as string);
      if (!existing || existing.organizationId !== org.id) throw DomainError.notFound("API key not found");
      const revoked = existing.revokedAt ? existing : await ctx.store.updateApiKey(existing.id, { revokedAt: nowIso() });
      await audit(ctx.store, {
        organizationId: org.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "apikey.revoked",
        targetType: "API_KEY",
        targetId: revoked.id,
        after: { name: revoked.name, prefix: revoked.prefix },
      });
      res.json(safeKey(revoked));
    }),
  );

  return router;
}

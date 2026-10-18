import express, { Router } from "express";
import { z } from "zod";
import { DomainError, splitExternalRef } from "@scopelock/domain";
import type { AppContext } from "../app-context.js";
import { asyncHandler } from "../http/errors.js";
import { rateLimit } from "../http/rate-limit.js";
import { captureRawBody, type ApiRequest } from "../http/types.js";
import { validateParams } from "../http/validate.js";
import { audit } from "../lib/audit.js";
import { logger } from "../logger.js";
import { unsealSecret } from "../lib/mfa.js";
import { GitHubProvider } from "../lib/providers/github.js";
import type { ObservedWork } from "../lib/providers/types.js";
import { nowIso } from "../store/index.js";

const IDEMPOTENCY_SCOPE = "github-delivery";
const IDEMPOTENCY_TTL_MS = 7 * 24 * 3600_000;

export function githubRoutes(ctx: AppContext): Router {
  const router = Router();
  // Own body parser: the main JSON parser is skipped for /api/v1/webhooks/*.
  router.use(express.json({ limit: "5mb", verify: captureRawBody }));
  router.post(
    "/webhooks/github/:connectionId",
    rateLimit(ctx.env, "token"),
    validateParams(z.object({ connectionId: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const connection = await ctx.store.findExternalConnectionById(req.params.connectionId as string);
      if (!connection) throw DomainError.notFound("Not found");
      const secret = unsealSecret(ctx.env.AUTH_SECRET, connection.secretSealed);
      if (!secret) {
        logger.warn("GitHub delivery for connection with unsealable secret", { connectionId: connection.id });
        throw DomainError.unprocessable("Connection secret is invalid; rotate it in project settings");
      }
      const rawBody = (req as ApiRequest).rawBody ?? "";
      GitHubProvider.verifySignature(secret, rawBody, {
        signature256: req.headers["x-hub-signature-256"] as string | undefined,
      });
      const delivery = req.headers["x-github-delivery"] as string | undefined;
      if (!delivery) throw DomainError.unprocessable("Missing X-GitHub-Delivery header");
      const event = (req.headers["x-github-event"] as string | undefined) ?? "unknown";

      if (event === "ping") {
        res.json({ status: "pong" });
        return;
      }

      const replay = await ctx.store.findIdempotency(delivery, IDEMPOTENCY_SCOPE);
      if (replay && replay.expiresAt > nowIso()) {
        res.json({ status: "duplicate" });
        return;
      }

      if (!connection.enabled) {
        await remember(ctx, delivery, { status: "dropped", reason: "connection-disabled" });
        res.json({ status: "dropped", reason: "connection-disabled" });
        return;
      }
      const project = await ctx.store.findProjectById(connection.projectId);
      if (!project || !project.externalIntegrationsEnabled) {
        logger.warn("GitHub delivery dropped: integrations disabled", { connectionId: connection.id });
        await remember(ctx, delivery, { status: "dropped", reason: "integrations-disabled" });
        res.json({ status: "dropped", reason: "integrations-disabled" });
        return;
      }

      const items = GitHubProvider.parseEvent(event, req.body);
      if (items.length === 0) {
        await remember(ctx, delivery, { status: "ignored", event });
        res.json({ status: "ignored", event });
        return;
      }

      const outcome = await ctx.store.transaction(async () => {
        let linked = 0;
        for (const item of items) {
          await ctx.store.upsertExternalWorkItem({
            projectId: project.id,
            provider: item.provider,
            externalId: item.externalId,
            kind: item.kind,
            url: item.url,
            title: item.title,
            refs: item.refs,
            merged: item.merged,
            mergedAt: item.mergedAt,
          });
          linked += await linkMatchedChanges(ctx, project.id, item);
        }
        // External events never change scope state: versions, requirements,
        // changes, and decisions are untouched. Observed identifiers, trace
        // links, and this audit row are evidence, not scope.
        await audit(ctx.store, {
          organizationId: project.organizationId,
          projectId: project.id,
          actorId: null,
          action: "external.observed",
          targetType: "PROJECT",
          targetId: project.id,
          after: {
            provider: "GITHUB",
            event,
            observed: items.length,
            merged: items.filter((i) => i.merged).length,
            linked,
          },
        });
        return { observed: items.length, merged: items.filter((i) => i.merged).length, linked };
      });

      await remember(ctx, delivery, { status: "ok", ...outcome });
      res.json({ status: "ok", ...outcome });
    }),
  );
  return router;
}

/**
 * Create trace links for CHG refs that resolve to project changes.
 * Idempotent: re-deliveries hit the link unique key and are skipped.
 * Links record where work happened; they never modify the change.
 */
async function linkMatchedChanges(ctx: AppContext, projectId: string, item: ObservedWork): Promise<number> {
  const numbers = new Set<string>();
  for (const ref of item.refs) {
    const split = splitExternalRef(ref);
    if (split?.kind === "CHANGE") numbers.add(split.ref);
  }
  if (numbers.size === 0) return 0;
  const changes = await ctx.store.listChanges(projectId);
  const byNumber = new Map(changes.map((c) => [c.number, c]));
  let linked = 0;
  for (const number of numbers) {
    const change = byNumber.get(number);
    if (!change) continue;
    try {
      await ctx.store.createExternalLink({
        projectId,
        changeRequestId: change.id,
        provider: item.provider,
        externalId: item.externalId,
        url: item.url,
        createdBy: `provider:${item.provider.toLowerCase()}`,
      });
      linked += 1;
    } catch {
      // Already linked (re-delivery or manual link): skip.
    }
  }
  return linked;
}

async function remember(ctx: AppContext, delivery: string, body: Record<string, unknown>): Promise<void> {
  await ctx.store.saveIdempotency({
    key: delivery,
    scope: IDEMPOTENCY_SCOPE,
    statusCode: 200,
    body,
    expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString(),
  });
}

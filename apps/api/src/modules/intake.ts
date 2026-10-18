import { Router } from "express";
import { z } from "zod";
import { CreateIntakeLinkSchema, IntakeSubmitSchema } from "@scopelock/contracts";
import { DomainError, newToken, sha256Hex } from "@scopelock/domain";
import type { AppContext } from "../app-context.js";
import { asyncHandler } from "../http/errors.js";
import { authenticate, requireAuth } from "../http/auth.js";
import { requireAction, requireProjectAccess } from "../http/access.js";
import { validateBody, validateParams } from "../http/validate.js";
import { rateLimit } from "../http/rate-limit.js";
import type { ApiRequest } from "../http/types.js";
import { audit } from "../lib/audit.js";
import { notifyProjectMembers } from "../lib/notify.js";
import { getContext } from "../context.js";
import { nowIso, type IntakeLink, type Store } from "../store/index.js";

/** Resolve a live intake link or throw a public-safe error. */
export async function loadIntakeLink(store: Store, rawToken: string): Promise<{ link: IntakeLink }> {
  const link = await store.findIntakeLinkByHash(sha256Hex(rawToken));
  if (!link || link.revokedAt) throw DomainError.notFound("Intake form not found");
  if (link.expiresAt && link.expiresAt <= nowIso()) throw DomainError.gone("This intake form has expired");
  return { link };
}

export function intakeRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use(authenticate(ctx.store));

  // ----- Staff: manage links -----
  router.get(
    "/projects/:id/intake-links",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "intake.manage");
      const links = await ctx.store.listIntakeLinks(access.project.id);
      res.json({
        data: links.map((l) => ({
          id: l.id,
          name: l.name,
          expiresAt: l.expiresAt,
          revokedAt: l.revokedAt,
          lastUsedAt: l.lastUsedAt,
          submissions: l.submissions,
          createdAt: l.createdAt,
          url: `${ctx.env.WEB_URL}/intake/<token>`,
        })),
        pagination: { nextCursor: null },
      });
    }),
  );

  router.post(
    "/projects/:id/intake-links",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(CreateIntakeLinkSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof CreateIntakeLinkSchema>;
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "intake.manage");
      if (input.expiresAt && Date.parse(input.expiresAt) <= Date.now()) {
        throw DomainError.unprocessable("Expiry must be in the future");
      }
      const token = newToken();
      const link = await ctx.store.createIntakeLink({
        projectId: access.project.id,
        name: input.name,
        tokenHash: sha256Hex(token),
        expiresAt: input.expiresAt ?? null,
        createdBy: auth.user.id,
      });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "intake_link.created",
        targetType: "INTAKE_LINK",
        targetId: link.id,
        after: { name: link.name, expiresAt: link.expiresAt },
      });
      res.status(201).json({ link: { ...link, tokenHash: undefined }, token, url: `${ctx.env.WEB_URL}/intake/${token}` });
    }),
  );

  router.post(
    "/intake-links/:id/revoke",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const link = await ctx.store.findIntakeLinkById(req.params.id as string);
      if (!link) throw DomainError.notFound("Intake link not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, link.projectId);
      requireAction(access.access, "intake.manage");
      if (link.revokedAt) throw DomainError.conflict("This intake link is already revoked");
      await ctx.store.updateIntakeLink(link.id, { revokedAt: nowIso() });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "intake_link.revoked",
        targetType: "INTAKE_LINK",
        targetId: link.id,
      });
      res.json({ ok: true });
    }),
  );

  // ----- Public: form info + submit (rate-limited, unauthenticated) -----
  router.get(
    "/intake/:token",
    rateLimit(ctx.env, "token"),
    validateParams(z.object({ token: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const { link } = await loadIntakeLink(ctx.store, req.params.token as string);
      const project = await ctx.store.findProjectById(link.projectId);
      if (!project) throw DomainError.notFound("Intake form not found");
      const org = await ctx.store.findOrganizationById(project.organizationId);
      res.json({
        projectName: project.name,
        organizationName: org?.name ?? "ScopeLock",
        branding: org?.branding ?? null,
      });
    }),
  );

  router.post(
    "/intake/:token/submit",
    rateLimit(ctx.env, "token"),
    validateParams(z.object({ token: z.string().min(1) })),
    validateBody(IntakeSubmitSchema),
    asyncHandler(async (req, res) => {
      const input = req.body as z.infer<typeof IntakeSubmitSchema>;
      const { link } = await loadIntakeLink(ctx.store, req.params.token as string);
      const project = await ctx.store.findProjectById(link.projectId);
      if (!project) throw DomainError.notFound("Intake form not found");
      const ctxInfo = getContext();

      // Honeypot: bots get a success-shaped response; nothing is created.
      if (input.website && input.website.trim().length > 0) {
        await ctx.store.recordMetric({
          organizationId: project.organizationId,
          projectId: project.id,
          name: "intake.honeypot",
          properties: { linkId: link.id },
          actorId: null,
        });
        res.status(201).json({ received: true });
        return;
      }

      const email = input.submitterEmail && input.submitterEmail.length > 0 ? input.submitterEmail : null;
      const change = await ctx.store.transaction(async (tx) => {
        const created = await tx.createChange({
          projectId: project.id,
          title: input.title,
          description: input.description,
          source: "INTAKE_FORM",
          status: "SUBMITTED",
          classification: null,
          classificationRationale: null,
          submitterId: null,
          submitterName: input.submitterName ?? null,
          submitterEmail: email,
          unverifiedSubmitter: true,
          bundleId: null,
          amendmentVersionId: null,
          drawAllowancePoolId: null,
        });
        await tx.updateIntakeLink(link.id, { lastUsedAt: nowIso(), submissions: link.submissions + 1 });
        await tx.appendAuditEvent({
          organizationId: project.organizationId,
          projectId: project.id,
          actorId: null,
          actorEmail: email,
          action: "intake.submitted",
          targetType: "CHANGE",
          targetId: created.id,
          after: { number: created.number, linkId: link.id, submitterName: input.submitterName ?? null },
          correlationId: ctxInfo?.correlationId ?? "no-correlation",
          ip: ctxInfo?.ip ?? req.ip ?? null,
        });
        await tx.recordMetric({
          organizationId: project.organizationId,
          projectId: project.id,
          name: "intake.submitted",
          properties: { linkId: link.id },
          actorId: null,
        });
        return created;
      });

      await notifyProjectMembers(ctx.store, {
        projectId: project.id,
        organizationId: project.organizationId,
        type: "INTAKE_SUBMITTED",
        title: `New intake submission ${change.number}`,
        body: `${change.title}${email ? ` — from ${email} (unverified)` : " — anonymous (unverified)"}`,
        link: `/projects/${project.id}/changes/${change.id}`,
      });
      res.status(201).json({ received: true, number: change.number });
    }),
  );

  return router;
}

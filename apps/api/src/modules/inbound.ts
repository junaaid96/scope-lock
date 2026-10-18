import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import express, { Router } from "express";
import { z } from "zod";
import { CreateMailboxSchema, InboundEmailSchema, SimulateInboundSchema } from "@scopelock/contracts";
import {
  DomainError,
  isAutoReply,
  looksLikeAutoSubject,
  mailboxLocalPart,
  parseEmailAddress,
  stripQuotedReply,
} from "@scopelock/domain";
import type { AppContext } from "../app-context.js";
import { asyncHandler } from "../http/errors.js";
import { authenticate, requireAuth } from "../http/auth.js";
import { requireAction, requireProjectAccess } from "../http/access.js";
import { validateBody, validateParams } from "../http/validate.js";
import { rateLimit } from "../http/rate-limit.js";
import { captureRawBody, type ApiRequest } from "../http/types.js";
import { audit } from "../lib/audit.js";
import { getContext } from "../context.js";
import { logger } from "../logger.js";
import { notifyProjectMembers } from "../lib/notify.js";
import { PLAN_LIMITS, assertStorageQuota } from "../lib/limits.js";
import { checksumsMatch, scanUpload } from "../lib/scan.js";
import { assertAllowedUpload } from "../lib/storage.js";
import { nowIso, type InboundMailbox, type Project } from "../store/index.js";

const SIGNATURE_WINDOW_SECONDS = 300;
const IDEMPOTENCY_SCOPE = "inbound-email";

/** Unguessable alias local part: 96 bits of entropy, lowercase hex. */
export function newAliasLocalPart(): string {
  return `chg-${randomBytes(12).toString("hex")}`;
}

export function mailboxAddress(env: { INBOUND_EMAIL_DOMAIN: string }, localPart: string): string {
  return `${localPart}@${env.INBOUND_EMAIL_DOMAIN}`;
}

interface VerifiedPayload {
  timestamp: number;
  signature: string;
}

function parseSignatureHeader(header: string | undefined): VerifiedPayload | null {
  if (!header) return null;
  const match = header.match(/^t=(\d+),v1=([0-9a-f]+)$/i);
  if (!match) return null;
  return { timestamp: Number(match[1]), signature: (match[2] as string).toLowerCase() };
}

/** Stripe-style HMAC check over "<timestamp>.<rawBody>". Throws 401/410 on failure. */
export function verifyWebhookSignature(secret: string, rawBody: string, header: string | undefined): void {
  if (!secret) throw DomainError.unprocessable("Inbound email is not configured");
  const parsed = parseSignatureHeader(header);
  if (!parsed) throw DomainError.unauthorized("Invalid webhook signature");
  const age = Math.abs(Date.now() / 1000 - parsed.timestamp);
  if (!Number.isFinite(age) || age > SIGNATURE_WINDOW_SECONDS) {
    throw DomainError.gone("Webhook signature has expired");
  }
  const expected = createHmac("sha256", secret).update(`${parsed.timestamp}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(parsed.signature, "hex");
  if (a.length !== b.length || a.length === 0 || !timingSafeEqual(a, b)) {
    throw DomainError.unauthorized("Invalid webhook signature");
  }
}

type InboundInput = z.infer<typeof InboundEmailSchema>;

export interface IngestOutcome {
  status: "created" | "duplicate" | "dropped";
  changeId?: string;
  number?: string;
  reason?: string;
}

/**
 * Shared ingest core for the signed webhook and the dev simulator.
 * Pure routing/validation first; the change + audit + metric commit in one
 * transaction; attachments flow through the standard upload + malware
 * pipeline before they link to the change.
 */
export async function ingestInboundEmail(
  ctx: AppContext,
  args: { project: Project; mailbox: InboundMailbox | null; ownerId: string; input: InboundInput },
): Promise<IngestOutcome> {
  const { project, input } = args;
  const org = await ctx.store.findOrganizationById(project.organizationId);
  if (!org) throw DomainError.notFound("Organization not found");
  const ctxInfo = getContext();

  const fromAddress = parseEmailAddress(input.from);
  const ownAddresses = [ctx.env.EMAIL_FROM, args.mailbox ? mailboxAddress(ctx.env, args.mailbox.localPart) : ""].filter(
    Boolean,
  );
  if (isAutoReply({ ...input.headers, from: input.from }, ownAddresses) || looksLikeAutoSubject(input.subject)) {
    await ctx.store.recordMetric({
      organizationId: org.id,
      projectId: project.id,
      name: "inbound.loop_dropped",
      properties: { messageId: input.messageId },
      actorId: null,
    });
    logger.info("Inbound email dropped as auto-reply/loop", { messageId: input.messageId });
    return { status: "dropped", reason: "auto-reply" };
  }

  const stripped = stripQuotedReply(input.textBody);
  if (stripped.length === 0) {
    await ctx.store.recordMetric({
      organizationId: org.id,
      projectId: project.id,
      name: "inbound.empty_dropped",
      properties: { messageId: input.messageId },
      actorId: null,
    });
    return { status: "dropped", reason: "empty-body" };
  }

  const title = (input.subject.trim() || stripped.split("\n")[0] || "Email request").slice(0, 200);
  const skipped = input.attachments.filter((a) => !a.contentBase64).map((a) => a.filename);
  const description = [stripped.slice(0, 12000), skipped.length > 0 ? `\n\nAttachments not fetched (no inline bytes): ${skipped.join(", ")}` : ""].join("");

  const change = await ctx.store.transaction(async (tx) => {
    const created = await tx.createChange({
      projectId: project.id,
      title,
      description,
      source: "INBOUND_EMAIL",
      status: "SUBMITTED",
      classification: null,
      classificationRationale: null,
      submitterId: null,
      submitterName: input.fromName ?? null,
      submitterEmail: fromAddress,
      unverifiedSubmitter: true,
      scopeCheckSuggestedIds: [],
      bundleId: null,
      amendmentVersionId: null,
      drawAllowancePoolId: null,
    });
    await tx.appendAuditEvent({
      organizationId: org.id,
      projectId: project.id,
      actorId: null,
      actorEmail: fromAddress,
      action: "inbound.received",
      targetType: "CHANGE",
      targetId: created.id,
      after: { number: created.number, messageId: input.messageId, mailboxId: args.mailbox?.id ?? null },
      correlationId: ctxInfo?.correlationId ?? "no-correlation",
      ip: ctxInfo?.ip ?? null,
    });
    await tx.recordMetric({
      organizationId: org.id,
      projectId: project.id,
      name: "inbound.received",
      properties: { messageId: input.messageId, attachments: input.attachments.length },
      actorId: null,
    });
    return created;
  });

  // Attachments ride the standard pipeline: quota + type gate, server-side
  // bytes, malware scan, then link. Failures quarantine the file, never the
  // change — the request itself is already safely recorded.
  for (const file of input.attachments) {
    if (!file.contentBase64) continue;
    try {
      const bytes = Buffer.from(file.contentBase64, "base64");
      if (bytes.length === 0 || bytes.length > 5 * 1024 * 1024) continue;
      assertAllowedUpload(file.contentType, bytes.length, PLAN_LIMITS[org.plan].uploadsBytes);
      await assertStorageQuota(ctx.store, org.id, org.plan, bytes.length);
      const checksum = createHash("sha256").update(bytes).digest("hex");
      const presigned = await ctx.storage.createUploadUrl(file.filename, file.contentType, bytes.length);
      await ctx.storage.putBytes(presigned.storageKey, bytes, file.contentType);
      const attachment = await ctx.store.createAttachment({
        projectId: project.id,
        ownerId: args.ownerId,
        fileName: file.filename,
        contentType: file.contentType,
        sizeBytes: bytes.length,
        checksum,
        storageKey: presigned.storageKey,
        status: "PENDING",
        linkedType: "CHANGE",
        linkedId: change.id,
      });
      const scan = await scanUpload(ctx.env, ctx.storage, attachment.storageKey, attachment.contentType);
      if (scan.actualSha256 && !checksumsMatch(scan.actualSha256, checksum)) continue;
      if (scan.verdict === "INFECTED") {
        await ctx.store.updateAttachment(attachment.id, { status: "QUARANTINED" });
        await audit(ctx.store, {
          organizationId: org.id,
          projectId: project.id,
          action: "attachment.quarantined",
          targetType: "ATTACHMENT",
          targetId: attachment.id,
          after: { reason: scan.reason },
        });
        continue;
      }
      await ctx.store.updateAttachment(attachment.id, { status: "READY", completedAt: nowIso() });
    } catch (err) {
      logger.warn("Inbound attachment skipped", { file: file.filename, error: err instanceof Error ? err.message : String(err) });
    }
  }

  await notifyProjectMembers(ctx.store, {
    projectId: project.id,
    organizationId: org.id,
    type: "INBOUND_RECEIVED",
    title: `New email request ${change.number}`,
    body: `${change.title}${fromAddress ? ` — from ${fromAddress} (unverified)` : ""}`,
    link: `/projects/${project.id}/changes/${change.id}`,
  });
  return { status: "created", changeId: change.id, number: change.number };
}

export function inboundRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use(authenticate(ctx.store));

  // ----- Staff: mailboxes -----
  router.get(
    "/projects/:id/inbound-mailboxes",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "intake.manage");
      const boxes = await ctx.store.listInboundMailboxes(access.project.id);
      res.json({
        data: boxes.map((b) => ({ ...b, address: mailboxAddress(ctx.env, b.localPart) })),
        pagination: { nextCursor: null },
      });
    }),
  );

  router.post(
    "/projects/:id/inbound-mailboxes",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(CreateMailboxSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof CreateMailboxSchema>;
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "intake.manage");
      const mailbox = await ctx.store.createInboundMailbox({
        projectId: access.project.id,
        name: input.name,
        localPart: newAliasLocalPart(),
        createdBy: auth.user.id,
      });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "inbound_mailbox.created",
        targetType: "INBOUND_MAILBOX",
        targetId: mailbox.id,
        after: { name: mailbox.name },
      });
      res.status(201).json({ ...mailbox, address: mailboxAddress(ctx.env, mailbox.localPart) });
    }),
  );

  router.delete(
    "/inbound-mailboxes/:id",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const mailbox = await ctx.store.findInboundMailboxById(req.params.id as string);
      if (!mailbox) throw DomainError.notFound("Mailbox not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, mailbox.projectId);
      requireAction(access.access, "intake.manage");
      await ctx.store.deleteInboundMailbox(mailbox.id);
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "inbound_mailbox.deleted",
        targetType: "INBOUND_MAILBOX",
        targetId: mailbox.id,
      });
      res.json({ ok: true });
    }),
  );

  // ----- Dev simulator (never in production) -----
  router.post(
    "/dev/simulate-inbound-email",
    requireAuth,
    validateBody(SimulateInboundSchema),
    asyncHandler(async (req, res) => {
      if (ctx.env.NODE_ENV === "production") throw DomainError.notFound("Not found");
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof SimulateInboundSchema>;
      const access = await requireProjectAccess(ctx.store, auth.user.id, input.projectId);
      requireAction(access.access, "intake.manage");
      const outcome = await ingestInboundEmail(ctx, {
        project: access.project,
        mailbox: null,
        ownerId: auth.user.id,
        input,
      });
      res.status(201).json(outcome);
    }),
  );

  // ----- Provider webhook (signature-verified, unauthenticated) -----
  const webhooks = Router();
  webhooks.use(express.json({ limit: "15mb", verify: captureRawBody }));
  webhooks.post(
    "/webhooks/inbound-email",
    rateLimit(ctx.env, "token"),
    validateBody(InboundEmailSchema),
    asyncHandler(async (req, res) => {
      const rawBody = (req as ApiRequest).rawBody ?? "";
      verifyWebhookSignature(ctx.env.INBOUND_EMAIL_WEBHOOK_SECRET, rawBody, req.headers["x-inbound-signature"] as string | undefined);
      const input = req.body as z.infer<typeof InboundEmailSchema>;

      const replay = await ctx.store.findIdempotency(input.messageId, IDEMPOTENCY_SCOPE);
      if (replay && replay.expiresAt > nowIso()) {
        res.json({ status: "duplicate" });
        return;
      }

      const toAddress = parseEmailAddress(input.to);
      const mailbox = toAddress ? await ctx.store.findInboundMailboxByLocalPart(mailboxLocalPart(toAddress)) : null;
      if (!mailbox) {
        logger.warn("Inbound email to unknown alias dropped", { to: input.to });
        await ctx.store.saveIdempotency({
          key: input.messageId,
          scope: IDEMPOTENCY_SCOPE,
          statusCode: 200,
          body: { status: "dropped", reason: "unknown-alias" },
          expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
        });
        res.json({ status: "dropped", reason: "unknown-alias" });
        return;
      }
      const project = await ctx.store.findProjectById(mailbox.projectId);
      if (!project) throw DomainError.notFound("Project not found");
      const outcome = await ingestInboundEmail(ctx, { project, mailbox, ownerId: mailbox.createdBy, input });
      await ctx.store.saveIdempotency({
        key: input.messageId,
        scope: IDEMPOTENCY_SCOPE,
        statusCode: 200,
        body: outcome,
        expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
      });
      res.json(outcome);
    }),
  );
  router.use(webhooks);

  return router;
}

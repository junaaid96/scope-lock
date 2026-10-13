import { createHash } from "node:crypto";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Router } from "express";
import express from "express";
import { z } from "zod";
import { CompleteUploadSchema, CreateUploadIntentSchema, ListQuerySchema } from "@scopelock/contracts";
import { DomainError } from "@scopelock/domain";
import type { AppContext } from "../app-context.js";
import { asyncHandler } from "../http/errors.js";
import { authenticate, requireAuth } from "../http/auth.js";
import { requireAction, requireProjectAccess } from "../http/access.js";
import { rateLimit } from "../http/rate-limit.js";
import { validateBody, validateParams, validateQuery } from "../http/validate.js";
import { paginateList } from "../http/pagination.js";
import type { ApiRequest } from "../http/types.js";
import { audit } from "../lib/audit.js";
import { checksumsMatch, scanUpload } from "../lib/scan.js";
import { assertAllowedUpload, verifyLocalSignature } from "../lib/storage.js";
import { PLAN_LIMITS, assertStorageQuota } from "../lib/limits.js";
import { currentPeriod, nowIso } from "../store/index.js";

export function fileRoutes(ctx: AppContext): Router {
  const router = Router();

  const authed = Router();
  authed.use(authenticate(ctx.store));

  authed.post(
    "/projects/:id/uploads/intents",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(CreateUploadIntentSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof CreateUploadIntentSchema>;
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "file.upload");
      try {
        assertAllowedUpload(input.contentType, input.sizeBytes, PLAN_LIMITS[access.org.plan].uploadsBytes);
      } catch (err) {
        throw DomainError.unprocessable(err instanceof Error ? err.message : "Upload not allowed");
      }
      await assertStorageQuota(ctx.store, access.org.id, access.org.plan, input.sizeBytes);
      if (input.linkedType === "CHANGE" && input.linkedId) {
        const change = await ctx.store.findChangeById(input.linkedId);
        if (!change || change.projectId !== access.project.id) throw DomainError.notFound("Change not found");
      }
      if (input.linkedType === "REQUIREMENT" && input.linkedId) {
        const req = await ctx.store.findRequirementById(input.linkedId);
        if (!req || req.projectId !== access.project.id) throw DomainError.notFound("Requirement not found");
      }
      const presigned = await ctx.storage.createUploadUrl(input.fileName, input.contentType, input.sizeBytes);
      const attachment = await ctx.store.createAttachment({
        projectId: access.project.id,
        ownerId: auth.user.id,
        fileName: input.fileName,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        checksum: input.checksumSha256.toLowerCase(),
        storageKey: presigned.storageKey,
        status: "PENDING",
        linkedType: input.linkedType ?? null,
        linkedId: input.linkedId ?? null,
      });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "attachment.intent_created",
        targetType: "ATTACHMENT",
        targetId: attachment.id,
        after: { fileName: input.fileName, sizeBytes: input.sizeBytes },
      });
      res.status(201).json({
        attachmentId: attachment.id,
        storageKey: presigned.storageKey,
        uploadUrl: presigned.uploadUrl,
        expiresAt: presigned.expiresAt,
      });
    }),
  );

  authed.post(
    "/attachments/:id/complete",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(CompleteUploadSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof CompleteUploadSchema>;
      const attachment = await ctx.store.findAttachmentById(req.params.id as string);
      if (!attachment) throw DomainError.notFound("Attachment not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, attachment.projectId);
      requireAction(access.access, "file.upload");
      if (attachment.ownerId !== auth.user.id) {
        // Only the uploader or a project lead may complete an upload.
        const isLead = access.projectMember?.role === "LEAD" || access.membership.role === "OWNER" || access.membership.role === "ADMIN";
        if (!isLead) throw DomainError.forbidden("Only the uploader or a project lead can complete this upload");
      }
      if (attachment.status !== "PENDING") throw DomainError.conflict(`Upload is already ${attachment.status}`);
      if (ctx.storage.name === "local") {
        const diskPath = `${ctx.env.UPLOAD_DIR}/${attachment.storageKey}`;
        if (!existsSync(diskPath)) {
          throw DomainError.unprocessable("No bytes were uploaded for this intent yet");
        }
        const stat = statSync(diskPath);
        if (stat.size !== attachment.sizeBytes) {
          throw DomainError.unprocessable(`Uploaded size ${stat.size} does not match declared ${attachment.sizeBytes}`);
        }
      }
      if (input.checksumSha256 && !checksumsMatch(input.checksumSha256, attachment.checksum)) {
        throw DomainError.unprocessable("Checksum mismatch: bytes do not match the declared checksum");
      }
      // Malware gate: nothing reaches READY without a scan verdict.
      const scan = await scanUpload(ctx.env, ctx.storage, attachment.storageKey, attachment.contentType);
      if (scan.actualSha256 && !checksumsMatch(scan.actualSha256, attachment.checksum)) {
        throw DomainError.unprocessable("Checksum mismatch: stored bytes do not match the declared checksum");
      }
      if (scan.verdict === "INFECTED") {
        await ctx.store.updateAttachment(attachment.id, { status: "QUARANTINED" });
        await audit(ctx.store, {
          organizationId: access.org.id,
          projectId: access.project.id,
          actorId: auth.user.id,
          actorEmail: auth.user.email,
          action: "attachment.quarantined",
          targetType: "ATTACHMENT",
          targetId: attachment.id,
          before: { status: "PENDING" },
          after: { status: "QUARANTINED", reason: scan.reason },
        });
        throw DomainError.unprocessable(`Upload failed the malware scan and was quarantined (${scan.reason ?? "flagged content"})`);
      }
      const updated = await ctx.store.transaction(async (tx) => {
        const next = await tx.updateAttachment(attachment.id, { status: "READY", completedAt: nowIso() });
        await tx.bumpUsage(access.org.id, currentPeriod(), { storageBytes: attachment.sizeBytes });
        return next;
      });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "attachment.completed",
        targetType: "ATTACHMENT",
        targetId: attachment.id,
        after: { status: "READY", scan: scan.verdict },
      });
      res.json(updated);
    }),
  );

  authed.get(
    "/attachments/:id/download-url",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const attachment = await ctx.store.findAttachmentById(req.params.id as string);
      if (!attachment || attachment.status !== "READY") throw DomainError.notFound("Attachment not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, attachment.projectId);
      requireAction(access.access, "file.download");
      const { downloadUrl, expiresAt } = await ctx.storage.createDownloadUrl(attachment.storageKey, attachment.fileName);
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "attachment.download_url_issued",
        targetType: "ATTACHMENT",
        targetId: attachment.id,
      });
      res.json({ downloadUrl, expiresAt, fileName: attachment.fileName, contentType: attachment.contentType });
    }),
  );

  authed.get(
    "/projects/:id/attachments",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateQuery(ListQuerySchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const q = (req as ApiRequest).validatedQuery as { cursor?: string; limit: number };
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "file.download");
      const attachments = await ctx.store.listAttachments(access.project.id);
      res.json(paginateList(attachments.map((a) => ({ ...a, storageKey: undefined })), q));
    }),
  );

  authed.delete(
    "/attachments/:id",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const attachment = await ctx.store.findAttachmentById(req.params.id as string);
      if (!attachment || attachment.status === "DELETED") throw DomainError.notFound("Attachment not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, attachment.projectId);
      requireAction(access.access, "file.upload");
      const isLead = access.projectMember?.role === "LEAD" || access.membership.role === "OWNER" || access.membership.role === "ADMIN";
      if (attachment.ownerId !== auth.user.id && !isLead) {
        throw DomainError.forbidden("Only the uploader or a project lead can delete this file");
      }
      await ctx.store.updateAttachment(attachment.id, { status: "DELETED" });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "attachment.deleted",
        targetType: "ATTACHMENT",
        targetId: attachment.id,
        before: { status: attachment.status },
        after: { status: "DELETED" },
      });
      res.json({ ok: true });
    }),
  );

  // ----- Local-driver byte endpoints (signed URLs, no session) -----
  const local = Router();
  /* local routes carry URL signatures, not sessions */

  local.put(
    "/files/local-upload",
    rateLimit(ctx.env, "default"),
    express.raw({ type: "*/*", limit: "100mb" }),
    asyncHandler(async (req, res) => {
      if (ctx.storage.name !== "local") throw DomainError.notFound("Not found");
      const key = String(req.query.key ?? "");
      const expires = String(req.query.expires ?? "");
      const sig = String(req.query.sig ?? "");
      if (!verifyLocalSignature(ctx.env.AUTH_SECRET, key, expires, sig)) {
        throw DomainError.forbidden("Invalid or expired upload URL");
      }
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || body.length === 0) throw DomainError.badRequest("Empty upload body");
      const diskPath = `${ctx.env.UPLOAD_DIR}/${key}`;
      mkdirSync(dirname(diskPath), { recursive: true });
      writeFileSync(diskPath, body);
      const checksum = createHash("sha256").update(body).digest("hex");
      res.json({ ok: true, sizeBytes: body.length, checksumSha256: checksum });
    }),
  );

  local.get(
    "/files/local-download",
    rateLimit(ctx.env, "default"),
    asyncHandler(async (req, res) => {
      if (ctx.storage.name !== "local") throw DomainError.notFound("Not found");
      const key = String(req.query.key ?? "");
      const expires = String(req.query.expires ?? "");
      const sig = String(req.query.sig ?? "");
      if (!verifyLocalSignature(ctx.env.AUTH_SECRET, key, expires, sig)) {
        throw DomainError.forbidden("Invalid or expired download URL");
      }
      const diskPath = `${ctx.env.UPLOAD_DIR}/${key}`;
      if (!existsSync(diskPath)) throw DomainError.notFound("File not found");
      res.sendFile(diskPath, { dotfiles: "deny" });
    }),
  );

  // Signed-URL byte endpoints first: they carry URL signatures, not sessions.
  router.use(local, authed);
  return router;
}

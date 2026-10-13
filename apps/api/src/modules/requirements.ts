import { Router } from "express";
import { z } from "zod";
import {
  CreateEvidenceSchema,
  CreateRequirementSchema,
  UpdateEvidenceSchema,
  UpdateRequirementStatusSchema,
  UpsertDraftRevisionSchema,
} from "@scopelock/contracts";
import { DomainError, RequirementTransitions, assertTransition } from "@scopelock/domain";
import type { AppContext } from "../app-context.js";
import { asyncHandler } from "../http/errors.js";
import { authenticate, requireAuth } from "../http/auth.js";
import { requireAction, requireProjectAccess } from "../http/access.js";
import { validateBody, validateParams, validateQuery } from "../http/validate.js";
import type { ApiRequest } from "../http/types.js";
import { audit } from "../lib/audit.js";
import type { ScopeVersion } from "../store/index.js";
import { getGoverningVersion } from "./scope.js";

function assertDraft(version: ScopeVersion): void {
  if (version.status !== "DRAFT") {
    throw DomainError.conflict(`Scope version ${version.sequence} is ${version.status} and immutable.`);
  }
}

export function requirementRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use(authenticate(ctx.store));

  // Governing view: every requirement with its published + open-draft content.
  router.get(
    "/projects/:id/requirements",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "scope.view");
      const [requirements, versions] = await Promise.all([
        ctx.store.listRequirements(access.project.id),
        ctx.store.listProjectScopeVersions(access.project.id),
      ]);
      const governing = await getGoverningVersion(ctx.store, access.project.id);
      const draft = versions.find((v) => v.status === "DRAFT") ?? null;
      const [publishedRevs, draftRevs] = await Promise.all([
        governing ? ctx.store.listRevisionsByVersion(governing.id) : Promise.resolve([]),
        draft ? ctx.store.listRevisionsByVersion(draft.id) : Promise.resolve([]),
      ]);
      const pubByReq = new Map(publishedRevs.map((r) => [r.requirementId, r]));
      const draftByReq = new Map(draftRevs.map((r) => [r.requirementId, r]));
      res.json({
        data: requirements.map((r) => ({
          ...r,
          published: pubByReq.get(r.id) ?? null,
          draft: draftByReq.get(r.id) ?? null,
        })),
        governingVersionId: governing?.id ?? null,
        draftVersionId: draft?.id ?? null,
      });
    }),
  );

  router.post(
    "/projects/:id/requirements",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(CreateRequirementSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof CreateRequirementSchema>;
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "scope.draft");
      const draft = await ctx.store.findScopeVersionById(input.draftVersionId);
      if (!draft || draft.projectId !== access.project.id) throw DomainError.notFound("Draft version not found");
      assertDraft(draft);
      const created = await ctx.store.transaction(async (tx) => {
        if (input.stableKey) {
          const existing = await tx.listRequirements(access.project.id);
          if (existing.some((r) => r.stableKey === input.stableKey)) {
            throw DomainError.conflict(`Stable key ${input.stableKey} is already used in this project`);
          }
        }
        const stableKey = input.stableKey ?? (await tx.allocateRequirementKey(access.project.id));
        const requirement = await tx.createRequirement(access.project.id, stableKey);
        const revision = await tx.upsertRevision({
          requirementId: requirement.id,
          scopeVersionId: draft.id,
          title: input.title,
          description: input.description,
          acceptanceCriteria: input.acceptanceCriteria,
          category: input.category ?? null,
          priority: input.priority ?? null,
          order: input.order,
        });
        await tx.updateScopeVersion(draft.id, { version: draft.version + 1 });
        return { requirement, revision };
      });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "requirement.created",
        targetType: "REQUIREMENT",
        targetId: created.requirement.id,
        after: { stableKey: created.requirement.stableKey, title: input.title },
      });
      res.status(201).json(created);
    }),
  );

  router.patch(
    "/requirements/:id",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(UpdateRequirementStatusSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof UpdateRequirementStatusSchema>;
      const requirement = await ctx.store.findRequirementById(req.params.id as string);
      if (!requirement) throw DomainError.notFound("Requirement not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, requirement.projectId);
      requireAction(access.access, "requirement.status");
      assertTransition(RequirementTransitions, requirement.status, input.status, "requirement");
      const updated = await ctx.store.updateRequirement(requirement.id, { status: input.status });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "requirement.status_changed",
        targetType: "REQUIREMENT",
        targetId: requirement.id,
        before: { status: requirement.status },
        after: { status: updated.status },
      });
      res.json(updated);
    }),
  );

  // Add a new requirement to a draft, or edit an existing revision in the draft.
  router.post(
    "/scope-versions/:draftId/requirements",
    requireAuth,
    validateParams(z.object({ draftId: z.string().min(1) })),
    validateBody(UpsertDraftRevisionSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof UpsertDraftRevisionSchema>;
      const draft = await ctx.store.findScopeVersionById(req.params.draftId as string);
      if (!draft) throw DomainError.notFound("Draft version not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, draft.projectId);
      requireAction(access.access, "scope.draft");
      assertDraft(draft);
      if (draft.version !== input.expectedVersion) {
        throw DomainError.conflict("This draft changed since you loaded it. Reload and retry.", {
          expected: input.expectedVersion,
          actual: draft.version,
        });
      }
      const result = await ctx.store.transaction(async (tx) => {
        const requirementId = input.requirementId ?? null;
        if (requirementId) {
          const req = await tx.findRequirementById(requirementId);
          if (!req || req.projectId !== access.project.id) throw DomainError.notFound("Requirement not found");
          const existing = (await tx.listRevisionsByVersion(draft.id)).find((r) => r.requirementId === requirementId);
          const title = input.title ?? existing?.title;
          const description = input.description ?? existing?.description;
          const acceptanceCriteria = input.acceptanceCriteria ?? existing?.acceptanceCriteria;
          if (!title || !description || !acceptanceCriteria) {
            throw DomainError.unprocessable("Title, description, and acceptance criteria are required");
          }
          const revision = await tx.upsertRevision({
            requirementId,
            scopeVersionId: draft.id,
            title,
            description,
            acceptanceCriteria,
            category: input.category ?? existing?.category ?? null,
            priority: input.priority ?? existing?.priority ?? null,
            order: input.order ?? existing?.order ?? 0,
          });
          await tx.updateScopeVersion(draft.id, { version: draft.version + 1 });
          return { requirementId, revision, created: false };
        }
        if (!input.title || !input.description) {
          throw DomainError.unprocessable("Title and description are required for a new requirement");
        }
        const stableKey = await tx.allocateRequirementKey(access.project.id);
        const requirement = await tx.createRequirement(access.project.id, stableKey);
        const revision = await tx.upsertRevision({
          requirementId: requirement.id,
          scopeVersionId: draft.id,
          title: input.title,
          description: input.description,
          acceptanceCriteria: input.acceptanceCriteria ?? [],
          category: input.category ?? null,
          priority: input.priority ?? null,
          order: input.order ?? 0,
        });
        await tx.updateScopeVersion(draft.id, { version: draft.version + 1 });
        return { requirementId: requirement.id, revision, created: true, stableKey };
      });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: result.created ? "requirement.created" : "requirement.revised",
        targetType: "REQUIREMENT",
        targetId: result.requirementId,
        after: { draftVersionId: draft.id },
      });
      res.status(result.created ? 201 : 200).json(result);
    }),
  );

  router.delete(
    "/scope-versions/:draftId/requirements/:requirementId",
    requireAuth,
    validateParams(z.object({ draftId: z.string().min(1), requirementId: z.string().min(1) })),
    validateQuery(z.object({ expectedVersion: z.coerce.number().int().min(0) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const q = (req as ApiRequest).validatedQuery as { expectedVersion: number };
      const draft = await ctx.store.findScopeVersionById(req.params.draftId as string);
      if (!draft) throw DomainError.notFound("Draft version not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, draft.projectId);
      requireAction(access.access, "scope.draft");
      assertDraft(draft);
      if (draft.version !== q.expectedVersion) {
        throw DomainError.conflict("This draft changed since you loaded it. Reload and retry.");
      }
      await ctx.store.transaction(async (tx) => {
        await tx.deleteRevision(req.params.requirementId as string, draft.id);
        await tx.updateScopeVersion(draft.id, { version: draft.version + 1 });
      });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "requirement.removed_from_draft",
        targetType: "REQUIREMENT",
        targetId: req.params.requirementId as string,
        after: { draftVersionId: draft.id },
      });
      res.json({ ok: true });
    }),
  );

  // ----- Delivery evidence -----
  router.get(
    "/requirements/:id/evidence",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const requirement = await ctx.store.findRequirementById(req.params.id as string);
      if (!requirement) throw DomainError.notFound("Requirement not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, requirement.projectId);
      requireAction(access.access, "scope.view");
      res.json({ data: await ctx.store.listEvidenceForRequirement(requirement.id) });
    }),
  );

  router.post(
    "/requirements/:id/evidence",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(CreateEvidenceSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof CreateEvidenceSchema>;
      const requirement = await ctx.store.findRequirementById(req.params.id as string);
      if (!requirement) throw DomainError.notFound("Requirement not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, requirement.projectId);
      requireAction(access.access, "evidence.attach");
      if (input.type === "FILE") {
        if (!input.attachmentId) throw DomainError.unprocessable("attachmentId is required for FILE evidence");
        const att = await ctx.store.findAttachmentById(input.attachmentId);
        if (!att || att.projectId !== access.project.id || att.status !== "READY") {
          throw DomainError.unprocessable("Attachment is not available for evidence");
        }
      }
      if (input.type === "URL" && !input.url) throw DomainError.unprocessable("url is required for URL evidence");
      const evidence = await ctx.store.createEvidence({
        requirementId: requirement.id,
        projectId: access.project.id,
        type: input.type,
        title: input.title,
        url: input.url ?? null,
        attachmentId: input.attachmentId ?? null,
        note: input.note ?? null,
        status: "PENDING",
        authorId: auth.user.id,
      });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "evidence.attached",
        targetType: "EVIDENCE",
        targetId: evidence.id,
        after: { requirementId: requirement.id, type: input.type },
      });
      res.status(201).json(evidence);
    }),
  );

  router.patch(
    "/evidence/:id",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(UpdateEvidenceSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof UpdateEvidenceSchema>;
      const evidence = await ctx.store.findEvidenceById(req.params.id as string);
      if (!evidence) throw DomainError.notFound("Evidence not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, evidence.projectId);
      requireAction(access.access, "evidence.verify");
      const updated = await ctx.store.updateEvidence(evidence.id, {
        status: input.status,
        verifierId: auth.user.id,
        verifiedAt: new Date().toISOString(),
      });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "evidence.verified",
        targetType: "EVIDENCE",
        targetId: updated.id,
        before: { status: evidence.status },
        after: { status: updated.status },
      });
      res.json(updated);
    }),
  );

  return router;
}

import { Router } from "express";
import { z } from "zod";
import {
  CreateDraftVersionSchema,
  ListQuerySchema,
  PublishVersionSchema,
  UpdateDraftVersionSchema,
} from "@scopelock/contracts";
import {
  DomainError,
  ScopeVersionTransitions,
  assertTransition,
  diffRevisions,
} from "@scopelock/domain";
import type { AppContext } from "../app-context.js";
import { asyncHandler } from "../http/errors.js";
import { authenticate, requireAuth } from "../http/auth.js";
import { requireAction, requireProjectAccess } from "../http/access.js";
import { idempotency } from "../http/idempotency.js";
import { validateBody, validateParams, validateQuery } from "../http/validate.js";
import { paginateList } from "../http/pagination.js";
import type { ApiRequest } from "../http/types.js";
import { audit } from "../lib/audit.js";
import { notifyProjectMembers } from "../lib/notify.js";
import type { ScopeVersion, Store } from "../store/index.js";
import { compareVersions } from "./ai/service.js";
import { invalidateAcceptanceForRequirements } from "./approvals.js";

export async function getGoverningVersion(store: Store, projectId: string): Promise<ScopeVersion | null> {
  const versions = await store.listProjectScopeVersions(projectId);
  const published = versions.filter((v) => v.status === "PUBLISHED");
  if (published.length === 0) return null;
  return published.sort((a, b) => b.sequence - a.sequence)[0] ?? null;
}

export interface DriftCandidateRow {
  requirementId: string;
  stableKey: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
}

/**
 * Lexical-match candidates from the governing baseline (published only).
 * Shared by the in-app scope check, the public intake check, and the
 * post-submission drift analysis so all three read the same baseline.
 */
export async function buildDriftCandidates(
  store: Store,
  projectId: string,
): Promise<{ version: ScopeVersion | null; candidates: DriftCandidateRow[] }> {
  const governing = await getGoverningVersion(store, projectId);
  if (!governing) return { version: null, candidates: [] };
  const revisions = await store.listRevisionsByVersion(governing.id);
  const requirements = await store.listRequirements(projectId);
  const keyById = new Map(requirements.map((r) => [r.id, r.stableKey]));
  return {
    version: governing,
    candidates: revisions.map((r) => ({
      requirementId: r.requirementId,
      stableKey: keyById.get(r.requirementId) ?? "?",
      title: r.title,
      description: r.description,
      acceptanceCriteria: r.acceptanceCriteria,
    })),
  };
}

function assertDraft(version: ScopeVersion): void {
  if (version.status !== "DRAFT") {
    throw DomainError.conflict(`Scope version ${version.sequence} is ${version.status} and immutable. Create a new draft to change it.`);
  }
}

function assertExpectedVersion(version: ScopeVersion, expected: number): void {
  if (version.version !== expected) {
    throw DomainError.conflict("This draft changed since you loaded it. Reload and retry.", {
      expected,
      actual: version.version,
    });
  }
}

export function scopeRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use(authenticate(ctx.store));

  // ----- Documents -----
  router.get(
    "/projects/:id/scope-documents",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateQuery(ListQuerySchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const q = (req as ApiRequest).validatedQuery as { cursor?: string; limit: number };
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "scope.view");
      res.json(paginateList(await ctx.store.listScopeDocuments(access.project.id), q));
    }),
  );

  router.post(
    "/projects/:id/scope-documents",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(z.object({ name: z.string().min(1).max(160) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "scope.draft");
      const doc = await ctx.store.createScopeDocument(access.project.id, (req.body as { name: string }).name);
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "scope.document_created",
        targetType: "SCOPE_DOCUMENT",
        targetId: doc.id,
        after: { name: doc.name },
      });
      res.status(201).json(doc);
    }),
  );

  // ----- Versions -----
  router.get(
    "/projects/:id/scope-versions",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateQuery(ListQuerySchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const q = (req as ApiRequest).validatedQuery as { cursor?: string; limit: number };
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "scope.view");
      const versions = await ctx.store.listProjectScopeVersions(access.project.id);
      const docs = await ctx.store.listScopeDocuments(access.project.id);
      const docById = new Map(docs.map((d) => [d.id, d]));
      res.json(paginateList(versions.map((v) => ({ ...v, documentName: docById.get(v.scopeDocumentId)?.name ?? null })), q));
    }),
  );

  router.post(
    "/projects/:id/scope-versions/draft",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(CreateDraftVersionSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof CreateDraftVersionSchema>;
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "scope.draft");

      const draft = await ctx.store.transaction(async (tx) => {
        let documentId = input.scopeDocumentId ?? null;
        if (documentId) {
          const doc = await tx.findScopeDocumentById(documentId);
          if (!doc || doc.projectId !== access.project.id) throw DomainError.notFound("Scope document not found");
        } else {
          const existing = await tx.listScopeDocuments(access.project.id);
          if (existing.length > 0 && !input.documentName) {
            documentId = existing[0]?.id ?? null;
          } else {
            const doc = await tx.createScopeDocument(access.project.id, input.documentName ?? "Project scope");
            documentId = doc.id;
          }
        }
        if (!documentId) throw DomainError.unprocessable("Could not resolve a scope document");
        const siblings = await tx.listScopeVersions(documentId);
        if (siblings.some((v) => v.status === "DRAFT")) {
          throw DomainError.conflict("A draft already exists for this document. Publish or edit it first.");
        }
        const created = await tx.createScopeVersion({
          scopeDocumentId: documentId,
          projectId: access.project.id,
          status: "DRAFT",
          title: input.title ?? null,
          summary: input.summary ?? null,
          assumptions: [],
          exclusions: [],
          version: 0,
          publishedAt: null,
          publishedBy: null,
          createdBy: auth.user.id,
          supersedesId: null,
        });
        if (input.copyFromVersionId) {
          const source = await tx.findScopeVersionById(input.copyFromVersionId);
          if (!source || source.projectId !== access.project.id) throw DomainError.notFound("Source version not found");
          const revisions = await tx.listRevisionsByVersion(source.id);
          for (const r of revisions) {
            await tx.upsertRevision({
              requirementId: r.requirementId,
              scopeVersionId: created.id,
              title: r.title,
              description: r.description,
              acceptanceCriteria: r.acceptanceCriteria,
              category: r.category,
              priority: r.priority,
              order: r.order,
            });
          }
          await tx.updateScopeVersion(created.id, { assumptions: source.assumptions, exclusions: source.exclusions });
        }
        return tx.findScopeVersionById(created.id);
      });
      if (!draft) throw DomainError.notFound("Draft not found");
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "scope.draft_created",
        targetType: "SCOPE_VERSION",
        targetId: draft.id,
        after: { sequence: draft.sequence },
      });
      res.status(201).json(draft);
    }),
  );

  router.get(
    "/scope-versions/:id",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const version = await ctx.store.findScopeVersionById(req.params.id as string);
      if (!version) throw DomainError.notFound("Scope version not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, version.projectId);
      requireAction(access.access, "scope.view");
      const revisions = await ctx.store.listRevisionsByVersion(version.id);
      const requirements = await ctx.store.listRequirements(version.projectId);
      const reqById = new Map(requirements.map((r) => [r.id, r]));
      res.json({
        ...version,
        revisions: revisions.map((r) => ({
          ...r,
          stableKey: reqById.get(r.requirementId)?.stableKey ?? null,
          status: reqById.get(r.requirementId)?.status ?? null,
        })),
      });
    }),
  );

  router.patch(
    "/scope-versions/:id",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(UpdateDraftVersionSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof UpdateDraftVersionSchema>;
      const version = await ctx.store.findScopeVersionById(req.params.id as string);
      if (!version) throw DomainError.notFound("Scope version not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, version.projectId);
      requireAction(access.access, "scope.draft");
      assertDraft(version);
      assertExpectedVersion(version, input.expectedVersion);
      const updated = await ctx.store.updateScopeVersion(version.id, {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.summary !== undefined ? { summary: input.summary } : {}),
        ...(input.assumptions !== undefined ? { assumptions: input.assumptions } : {}),
        ...(input.exclusions !== undefined ? { exclusions: input.exclusions } : {}),
        version: version.version + 1,
      });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "scope.draft_updated",
        targetType: "SCOPE_VERSION",
        targetId: version.id,
        before: { version: version.version },
        after: { version: updated.version },
      });
      res.json(updated);
    }),
  );

  router.post(
    "/scope-versions/:id/publish",
    requireAuth,
    idempotency(ctx.store, "scope-publish"),
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(PublishVersionSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof PublishVersionSchema>;
      const version = await ctx.store.findScopeVersionById(req.params.id as string);
      if (!version) throw DomainError.notFound("Scope version not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, version.projectId);
      requireAction(access.access, "scope.publish");
      assertDraft(version);
      assertExpectedVersion(version, input.expectedVersion);

      const published = await ctx.store.transaction(async (tx) => {
        const revisions = await tx.listRevisionsByVersion(version.id);
        if (revisions.length === 0) {
          throw DomainError.unprocessable("Cannot publish an empty scope. Add at least one requirement.");
        }
        for (const r of revisions) {
          if (!r.title.trim() || !r.description.trim()) {
            throw DomainError.unprocessable("Every requirement needs a title and description before publishing.");
          }
        }
        const siblings = await tx.listScopeVersions(version.scopeDocumentId);
        const current = siblings.find((v) => v.status === "PUBLISHED") ?? null;
        // RULE4: a baseline publishes freely, but an amendment (anything that
        // supersedes a published version) requires a linked APPROVED change.
        if (current) {
          const projectChanges = await tx.listChanges(version.projectId);
          const approvedLink = projectChanges.some(
            (c) => c.amendmentVersionId === version.id && (c.status === "APPROVED" || c.status === "IMPLEMENTED"),
          );
          if (!approvedLink) {
            throw DomainError.unprocessable(
              "Amendments require an approved change. Convert an approved change into scope, or link one to this draft, before publishing.",
            );
          }
        }
        assertTransition(ScopeVersionTransitions, version.status, "PUBLISHED", "scope version");
        const now = new Date().toISOString();
        const next = await tx.updateScopeVersion(version.id, {
          status: "PUBLISHED",
          version: version.version + 1,
          publishedAt: now,
          publishedBy: auth.user.id,
          supersedesId: current?.id ?? null,
        });
        if (current) {
          assertTransition(ScopeVersionTransitions, current.status, "SUPERSEDED", "scope version");
          await tx.updateScopeVersion(current.id, { status: "SUPERSEDED" });
        }
        // Newly published requirements join the agreed baseline.
        for (const r of revisions) {
          const req = await tx.findRequirementById(r.requirementId);
          if (req && req.status === "PROPOSED") await tx.updateRequirement(req.id, { status: "AGREED" });
        }
        // Publishing rewrites the reviewed content: pending acceptance over
        // these requirements must be re-sent against the new baseline.
        await invalidateAcceptanceForRequirements(tx, {
          organizationId: access.org.id,
          projectId: access.project.id,
          actorId: auth.user.id,
          actorEmail: auth.user.email,
          requirementIds: revisions.map((r) => r.requirementId),
          reason: `scope v${version.sequence} published with new content`,
        });
        await tx.recordMetric({
          organizationId: access.org.id,
          projectId: access.project.id,
          name: current ? "scope.amendment_published" : "scope.baseline_published",
          properties: { sequence: next.sequence, requirementCount: revisions.length },
          actorId: auth.user.id,
        });
        // ARCH5: the publish audit + fan-out outbox entries commit atomically
        // with the version flip, so a crash can never lose the audit trail.
        await audit(tx, {
          organizationId: access.org.id,
          projectId: access.project.id,
          actorId: auth.user.id,
          actorEmail: auth.user.email,
          action: "scope.published",
          targetType: "SCOPE_VERSION",
          targetId: next.id,
          before: { status: "DRAFT", supersedesId: null },
          after: { status: "PUBLISHED", sequence: next.sequence, supersedesId: next.supersedesId },
        });
        await notifyProjectMembers(tx, {
          projectId: access.project.id,
          organizationId: access.org.id,
          excludeUserId: auth.user.id,
          type: "SCOPE_PUBLISHED",
          title: `Scope v${next.sequence} published`,
          body: `${revisions.length} requirement(s) are now the agreed baseline.`,
          link: `/projects/${access.project.id}/scope`,
        });
        return { next, superseded: current, requirementCount: revisions.length };
      });

      res.json(published.next);
    }),
  );

  router.get(
    "/scope-versions/:id/diff/:otherId",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1), otherId: z.string().min(1) })),
    validateQuery(z.object({ semantic: z.coerce.boolean().optional().default(false) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const from = await ctx.store.findScopeVersionById(req.params.id as string);
      const to = await ctx.store.findScopeVersionById(req.params.otherId as string);
      if (!from || !to) throw DomainError.notFound("Scope version not found");
      if (from.projectId !== to.projectId) throw DomainError.badRequest("Versions belong to different projects");
      const access = await requireProjectAccess(ctx.store, auth.user.id, from.projectId);
      requireAction(access.access, "scope.view");
      const [fromRev, toRev] = await Promise.all([
        ctx.store.listRevisionsByVersion(from.id),
        ctx.store.listRevisionsByVersion(to.id),
      ]);
      const requirements = await ctx.store.listRequirements(from.projectId);
      const keyById = new Map(requirements.map((r) => [r.id, r.stableKey]));
      const shape = (r: (typeof fromRev)[number]): Parameters<typeof diffRevisions>[2][number] => ({
        requirementId: r.requirementId,
        stableKey: keyById.get(r.requirementId) ?? "?",
        title: r.title,
        description: r.description,
        acceptanceCriteria: r.acceptanceCriteria,
        category: r.category,
        priority: r.priority,
        order: r.order,
      });
      const diff = diffRevisions(from.id, to.id, fromRev.map(shape), toRev.map(shape), {
        fromAssumptions: from.assumptions,
        toAssumptions: to.assumptions,
        fromExclusions: from.exclusions,
        toExclusions: to.exclusions,
      });
      const q = (req as ApiRequest).validatedQuery as { semantic?: boolean };
      if (q.semantic) {
        requireAction(access.access, "ai.use");
        const analysis = await compareVersions(
          { store: ctx.store, env: ctx.env, user: auth.user, project: access.project, organizationId: access.org.id, plan: access.org.plan, orgAiEnabled: access.org.aiEnabled },
          diff,
        );
        res.json({ diff, semantic: analysis.output, aiStatus: analysis.status, analysisId: analysis.id });
        return;
      }
      res.json({ diff });
    }),
  );

  return router;
}

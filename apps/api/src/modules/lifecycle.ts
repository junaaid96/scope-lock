import { Router } from "express";
import { z } from "zod";
import {
  BundleMemberSchema,
  ConvertToScopeSchema,
  CreateBundleSchema,
  ListQuerySchema,
  UpdateBundleSchema,
} from "@scopelock/contracts";
import { BundleTransitions, DomainError, assertTransition, combineBundlePrice } from "@scopelock/domain";
import type { AppContext } from "../app-context.js";
import { asyncHandler } from "../http/errors.js";
import { authenticate, requireAuth } from "../http/auth.js";
import { requireAction, requireProjectAccess } from "../http/access.js";
import { validateBody, validateParams, validateQuery } from "../http/validate.js";
import { paginateList } from "../http/pagination.js";
import type { ApiRequest } from "../http/types.js";
import { audit } from "../lib/audit.js";
import { notifyProjectMembers } from "../lib/notify.js";
import type { Bundle, ChangeRequest, Store } from "../store/index.js";
import { nowIso } from "../store/index.js";
import { getGoverningVersion } from "./scope.js";
import { getSendBlockers } from "./changes.js";

const BUNDLEABLE = ["DRAFT", "SUBMITTED", "TRIAGING", "NEEDS_CLARIFICATION", "ESTIMATING"] as const;

export interface CombinedImpact {
  priceMinor: number | null;
  currency: string | null;
  effortDays: number | null;
  timelineDays: number | null;
  risks: string[];
  exclusions: string[];
  memberImpacts: Array<{ changeId: string; number: string; priceMinor: number | null; effortDays: number | null }>;
  missingImpact: string[];
  currencyMismatch: boolean;
}

export async function combineBundleImpact(store: Store, bundle: Bundle): Promise<CombinedImpact> {
  const members = await store.listChanges(bundle.projectId, { bundleId: bundle.id });
  const memberImpacts: CombinedImpact["memberImpacts"] = [];
  const missingImpact: string[] = [];
  const currencies = new Set<string>();
  const risks = new Set<string>();
  const exclusions = new Set<string>();
  let effort = 0;
  let hasEffort = false;
  let timeline: number | null = null;
  for (const m of members) {
    const impact = await store.findLatestImpact(m.id);
    memberImpacts.push({ changeId: m.id, number: m.number, priceMinor: impact?.priceMinor ?? null, effortDays: impact?.effortDays ?? null });
    if (!impact || impact.priceMinor === null || !impact.currency) {
      missingImpact.push(m.number);
      continue;
    }
    currencies.add(impact.currency);
    if (impact.effortDays !== null) {
      effort += impact.effortDays;
      hasEffort = true;
    }
    if (impact.timelineDays !== null) timeline = Math.max(timeline ?? 0, impact.timelineDays);
    for (const r of impact.risks) risks.add(r);
    for (const e of impact.exclusions) exclusions.add(e);
  }
  const prices = memberImpacts.map((m) => m.priceMinor);
  const priceMinor = missingImpact.length === 0 && currencies.size <= 1
    ? combineBundlePrice(prices, bundle.adjustmentMinor)
    : null;
  return {
    priceMinor,
    currency: currencies.size === 1 ? [...currencies][0] ?? null : null,
    effortDays: hasEffort ? Math.round(effort * 100) / 100 : null,
    timelineDays: timeline,
    risks: [...risks],
    exclusions: [...exclusions],
    memberImpacts,
    missingImpact,
    currencyMismatch: currencies.size > 1,
  };
}

export async function getBundleSendBlockers(store: Store, bundle: Bundle): Promise<string[]> {
  const blockers: string[] = [];
  const members = await store.listChanges(bundle.projectId, { bundleId: bundle.id });
  if (members.length === 0) blockers.push("The bundle has no change requests.");
  for (const m of members) {
    if (m.status !== "ESTIMATING") blockers.push(`${m.number} must be ESTIMATING to send (currently ${m.status}).`);
    const memberBlockers = (await getSendBlockers(store, m)).filter((b) => !b.includes("Status must be"));
    for (const b of memberBlockers) blockers.push(`${m.number}: ${b}`);
  }
  const approvals = await store.listApprovalsForBundle(bundle.id);
  if (approvals.some((a) => a.status === "SENT")) blockers.push("A review package for this bundle is already awaiting decision.");
  const combined = await combineBundleImpact(store, bundle);
  if (combined.currencyMismatch) blockers.push("Member impacts use different currencies. Align them before sending.");
  return [...new Set(blockers)];
}

async function assertBundleable(change: ChangeRequest): Promise<void> {
  if (!(BUNDLEABLE as readonly string[]).includes(change.status)) {
    throw DomainError.unprocessable(`Only unapproved requests can be bundled (${change.number} is ${change.status})`);
  }
}

export function lifecycleRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use(authenticate(ctx.store));

  // Assign one change to a bundle (existing or newly created).
  router.post(
    "/change-requests/:id/bundle",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(z.object({ bundleId: z.string().min(1).optional(), name: z.string().min(1).max(160).optional() })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as { bundleId?: string; name?: string };
      const change = await ctx.store.findChangeById(req.params.id as string);
      if (!change) throw DomainError.notFound("Change request not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, change.projectId);
      requireAction(access.access, "bundle.manage");
      await assertBundleable(change);
      if (!input.bundleId && !input.name) throw DomainError.unprocessable("Provide bundleId or name");
      const bundle = await ctx.store.transaction(async (tx) => {
        let target = input.bundleId ? await tx.findBundleById(input.bundleId) : null;
        if (input.bundleId && (!target || target.projectId !== access.project.id)) {
          throw DomainError.notFound("Bundle not found");
        }
        if (!target) {
          target = await tx.createBundle({
            projectId: access.project.id,
            name: input.name as string,
            adjustmentMinor: 0,
            adjustmentNote: null,
            createdBy: auth.user.id,
          });
        }
        if (target.status !== "DRAFT") throw DomainError.unprocessable("Only draft bundles accept new members");
        await tx.updateChange(change.id, { bundleId: target.id, version: change.version + 1 });
        return target;
      });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "bundle.member_added",
        targetType: "BUNDLE",
        targetId: bundle.id,
        after: { changeId: change.id, number: change.number },
      });
      res.json(bundle);
    }),
  );

  // Convert an approved change into a scope amendment draft (publish stays explicit).
  router.post(
    "/change-requests/:id/convert-to-scope",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(ConvertToScopeSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof ConvertToScopeSchema>;
      const change = await ctx.store.findChangeById(req.params.id as string);
      if (!change) throw DomainError.notFound("Change request not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, change.projectId);
      requireAction(access.access, "change.convert");
      if (change.status !== "APPROVED") {
        throw DomainError.unprocessable("Only approved changes can be converted into scope");
      }
      if (change.amendmentVersionId) {
        throw DomainError.conflict("This change already has a linked amendment draft");
      }
      const governing = await getGoverningVersion(ctx.store, access.project.id);
      // Link mode: attach the approved change to an existing draft so a manual
      // amendment draft can satisfy the RULE4 publish gate.
      if (input.scopeVersionId) {
        const existing = await ctx.store.findScopeVersionById(input.scopeVersionId);
        if (!existing || existing.projectId !== access.project.id) throw DomainError.notFound("Scope draft not found");
        if (existing.status !== "DRAFT") throw DomainError.unprocessable("Only draft versions accept linked changes");
        await ctx.store.updateChange(change.id, { amendmentVersionId: existing.id, version: change.version + 1 });
        await audit(ctx.store, {
          organizationId: access.org.id,
          projectId: access.project.id,
          actorId: auth.user.id,
          actorEmail: auth.user.email,
          action: "change.converted_to_scope",
          targetType: "CHANGE",
          targetId: change.id,
          after: { amendmentVersionId: existing.id, linked: true },
        });
        res.status(200).json(existing);
        return;
      }
      const draft = await ctx.store.transaction(async (tx) => {
        let documentId = input.scopeDocumentId ?? governing?.scopeDocumentId ?? null;
        if (documentId) {
          const doc = await tx.findScopeDocumentById(documentId);
          if (!doc || doc.projectId !== access.project.id) throw DomainError.notFound("Scope document not found");
        } else {
          const doc = await tx.createScopeDocument(access.project.id, "Project scope");
          documentId = doc.id;
        }
        const siblings = await tx.listScopeVersions(documentId);
        if (siblings.some((v) => v.status === "DRAFT")) {
          throw DomainError.conflict(
            "A draft already exists. Edit it to include this change, then link via convert with scopeVersionId before publishing.",
          );
        }
        const created = await tx.createScopeVersion({
          scopeDocumentId: documentId,
          projectId: access.project.id,
          status: "DRAFT",
          title: input.title ?? `Amendment for ${change.number}`,
          summary: `Amendment draft for approved change ${change.number}: ${change.title}`,
          assumptions: governing?.assumptions ?? [],
          exclusions: governing?.exclusions ?? [],
          version: 0,
          publishedAt: null,
          publishedBy: null,
          createdBy: auth.user.id,
          supersedesId: null,
        });
        if (governing) {
          for (const r of await tx.listRevisionsByVersion(governing.id)) {
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
        }
        await tx.updateChange(change.id, { amendmentVersionId: created.id, version: change.version + 1 });
        return created;
      });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "change.converted_to_scope",
        targetType: "CHANGE",
        targetId: change.id,
        after: { amendmentVersionId: draft.id },
      });
      res.status(201).json(draft);
    }),
  );

  router.post(
    "/change-requests/:id/implement",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(z.object({ expectedVersion: z.number().int().min(0) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as { expectedVersion: number };
      const change = await ctx.store.findChangeById(req.params.id as string);
      if (!change) throw DomainError.notFound("Change request not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, change.projectId);
      requireAction(access.access, "change.implement");
      if (change.version !== input.expectedVersion) throw DomainError.conflict("Stale request version. Reload and retry.");
      if (change.status !== "APPROVED") {
        throw DomainError.unprocessable(`Only approved changes can be marked implemented (currently ${change.status})`);
      }
      const updated = await ctx.store.transaction(async (tx) => {
        const next = await tx.updateChange(change.id, {
          status: "IMPLEMENTED",
          implementedAt: nowIso(),
          version: change.version + 1,
        });
        await tx.recordMetric({
          organizationId: access.org.id,
          projectId: access.project.id,
          name: "change.implemented",
          properties: { number: change.number },
          actorId: auth.user.id,
        });
        return next;
      });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "change.implemented",
        targetType: "CHANGE",
        targetId: change.id,
        before: { status: "APPROVED" },
        after: { status: "IMPLEMENTED" },
      });
      await notifyProjectMembers(ctx.store, {
        projectId: access.project.id,
        organizationId: access.org.id,
        excludeUserId: auth.user.id,
        type: "CHANGE_IMPLEMENTED",
        title: `${change.number} marked implemented`,
        body: change.title,
        link: `/projects/${access.project.id}/changes/${change.id}`,
      });
      res.json(updated);
    }),
  );

  // ----- Bundles -----
  router.get(
    "/projects/:id/bundles",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateQuery(ListQuerySchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const q = (req as ApiRequest).validatedQuery as { cursor?: string; limit: number };
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "project.view");
      const bundles = await ctx.store.listBundles(access.project.id);
      const data = await Promise.all(
        bundles.map(async (b) => ({
          ...b,
          members: await ctx.store.listChanges(b.projectId, { bundleId: b.id }),
          combined: await combineBundleImpact(ctx.store, b),
        })),
      );
      res.json(paginateList(data, q));
    }),
  );

  router.post(
    "/projects/:id/bundles",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(CreateBundleSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof CreateBundleSchema>;
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "bundle.manage");
      const bundle = await ctx.store.transaction(async (tx) => {
        const created = await tx.createBundle({
          projectId: access.project.id,
          name: input.name,
          adjustmentMinor: input.adjustmentMinor,
          adjustmentNote: input.adjustmentNote ?? null,
          createdBy: auth.user.id,
        });
        for (const changeId of [...new Set(input.changeRequestIds)]) {
          const change = await tx.findChangeById(changeId);
          if (!change || change.projectId !== access.project.id) throw DomainError.notFound(`Change not found: ${changeId}`);
          await assertBundleable(change);
          if (change.bundleId) throw DomainError.conflict(`${change.number} already belongs to a bundle`);
          await tx.updateChange(change.id, { bundleId: created.id, version: change.version + 1 });
        }
        return created;
      });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "bundle.created",
        targetType: "BUNDLE",
        targetId: bundle.id,
        after: { name: bundle.name, members: input.changeRequestIds.length },
      });
      res.status(201).json(bundle);
    }),
  );

  router.get(
    "/bundles/:id",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const bundle = await ctx.store.findBundleById(req.params.id as string);
      if (!bundle) throw DomainError.notFound("Bundle not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, bundle.projectId);
      requireAction(access.access, "project.view");
      const [members, approvals, combined, sendBlockers] = await Promise.all([
        ctx.store.listChanges(bundle.projectId, { bundleId: bundle.id }),
        ctx.store.listApprovalsForBundle(bundle.id),
        combineBundleImpact(ctx.store, bundle),
        getBundleSendBlockers(ctx.store, bundle),
      ]);
      res.json({ ...bundle, members, approvals, combined, sendBlockers });
    }),
  );

  router.patch(
    "/bundles/:id",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(UpdateBundleSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof UpdateBundleSchema>;
      const bundle = await ctx.store.findBundleById(req.params.id as string);
      if (!bundle) throw DomainError.notFound("Bundle not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, bundle.projectId);
      requireAction(access.access, "bundle.manage");
      if (bundle.status !== "DRAFT") throw DomainError.unprocessable("Only draft bundles can be edited");
      const updated = await ctx.store.updateBundle(bundle.id, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.adjustmentMinor !== undefined ? { adjustmentMinor: input.adjustmentMinor } : {}),
        ...(input.adjustmentNote !== undefined ? { adjustmentNote: input.adjustmentNote } : {}),
      });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "bundle.updated",
        targetType: "BUNDLE",
        targetId: bundle.id,
        after: { name: updated.name },
      });
      res.json(updated);
    }),
  );

  router.post(
    "/bundles/:id/members",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(BundleMemberSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof BundleMemberSchema>;
      const bundle = await ctx.store.findBundleById(req.params.id as string);
      if (!bundle) throw DomainError.notFound("Bundle not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, bundle.projectId);
      requireAction(access.access, "bundle.manage");
      if (bundle.status !== "DRAFT") throw DomainError.unprocessable("Only draft bundles accept new members");
      const change = await ctx.store.findChangeById(input.changeRequestId);
      if (!change || change.projectId !== access.project.id) throw DomainError.notFound("Change not found");
      await assertBundleable(change);
      if (change.bundleId && change.bundleId !== bundle.id) throw DomainError.conflict("This change already belongs to a bundle");
      await ctx.store.updateChange(change.id, { bundleId: bundle.id, version: change.version + 1 });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "bundle.member_added",
        targetType: "BUNDLE",
        targetId: bundle.id,
        after: { changeId: change.id },
      });
      res.json({ ok: true });
    }),
  );

  router.delete(
    "/bundles/:id/members/:changeId",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1), changeId: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const bundle = await ctx.store.findBundleById(req.params.id as string);
      if (!bundle) throw DomainError.notFound("Bundle not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, bundle.projectId);
      requireAction(access.access, "bundle.manage");
      if (bundle.status !== "DRAFT") throw DomainError.unprocessable("Only draft bundles can be edited");
      const change = await ctx.store.findChangeById(req.params.changeId as string);
      if (!change || change.bundleId !== bundle.id) throw DomainError.notFound("Bundle member not found");
      await ctx.store.updateChange(change.id, { bundleId: null, version: change.version + 1 });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "bundle.member_removed",
        targetType: "BUNDLE",
        targetId: bundle.id,
        before: { changeId: change.id },
      });
      res.json({ ok: true });
    }),
  );

  router.post(
    "/bundles/:id/transition",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(z.object({ status: z.enum(["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED"]) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as { status: Bundle["status"] };
      const bundle = await ctx.store.findBundleById(req.params.id as string);
      if (!bundle) throw DomainError.notFound("Bundle not found");
      const access = await requireProjectAccess(ctx.store, auth.user.id, bundle.projectId);
      requireAction(access.access, "bundle.manage");
      if (input.status === "APPROVED" || input.status === "PENDING_APPROVAL") {
        throw DomainError.unprocessable(`${input.status} is reached through the approval flow, not directly`);
      }
      assertTransition(BundleTransitions, bundle.status, input.status, "bundle");
      const updated = await ctx.store.updateBundle(bundle.id, { status: input.status });
      res.json(updated);
    }),
  );

  return router;
}

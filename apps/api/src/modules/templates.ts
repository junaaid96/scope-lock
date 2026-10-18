import { Router } from "express";
import { z } from "zod";
import {
  CreateScopeTemplateSchema,
  CsvImportResponseSchema,
  CsvImportSchema,
  InstantiateTemplateSchema,
  RequirementContentSchema,
  UpdateScopeTemplateSchema,
} from "@scopelock/contracts";
import { applyTemplate, CsvParseError, DomainError, headerIndex, parseCsv, splitCriteria } from "@scopelock/domain";
import type { AppContext } from "../app-context.js";
import { asyncHandler } from "../http/errors.js";
import { authenticate, requireAuth } from "../http/auth.js";
import { requireAction, requireOrgAccess, requireProjectAccess } from "../http/access.js";
import { validateBody, validateParams, validateQuery } from "../http/validate.js";
import type { ApiRequest } from "../http/types.js";
import { audit } from "../lib/audit.js";
import type { Store } from "../store/index.js";

const STABLE_KEY_PATTERN = /^[A-Z0-9-]{1,24}$/;

interface CsvRow {
  row: number;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  category: string | null;
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null;
  stableKey: string | null;
}

interface RowError {
  row: number;
  field: string;
  message: string;
}

/** Parse + validate CSV into rows, collecting per-row errors (never throws on row issues). */
function parseRequirementCsv(csv: string): { rows: CsvRow[]; errors: RowError[]; totalRows: number } {
  const table = parseCsv(csv);
  const cols = headerIndex(table.header);
  const titleCol = cols.get("title");
  const descCol = cols.get("description");
  if (titleCol === undefined || descCol === undefined) {
    throw new CsvParseError(1, "Header must include title and description columns");
  }
  const criteriaCol = cols.get("acceptancecriteria");
  const categoryCol = cols.get("category");
  const priorityCol = cols.get("priority");
  const keyCol = cols.get("stablekey");
  const rows: CsvRow[] = [];
  const errors: RowError[] = [];
  table.rows.forEach((cells, i) => {
    const row = i + 1;
    const title = (cells[titleCol] ?? "").trim();
    const description = (cells[descCol] ?? "").trim();
    const acceptanceCriteria = splitCriteria(criteriaCol !== undefined ? cells[criteriaCol] : undefined);
    const categoryRaw = (categoryCol !== undefined ? (cells[categoryCol] ?? "") : "").trim();
    const priorityRaw = (priorityCol !== undefined ? (cells[priorityCol] ?? "") : "").trim().toUpperCase();
    const keyRaw = (keyCol !== undefined ? (cells[keyCol] ?? "") : "").trim().toUpperCase();
    const parsed = RequirementContentSchema.safeParse({
      title,
      description,
      acceptanceCriteria,
      ...(categoryRaw ? { category: categoryRaw } : {}),
      ...(priorityRaw ? { priority: priorityRaw } : {}),
      order: 0,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({ row, field: String(issue.path[0] ?? "row"), message: issue.message });
      }
      return;
    }
    if (keyRaw && !STABLE_KEY_PATTERN.test(keyRaw)) {
      errors.push({ row, field: "stableKey", message: "Stable key like REQ-001" });
      return;
    }
    rows.push({
      row,
      title: parsed.data.title,
      description: parsed.data.description,
      acceptanceCriteria: parsed.data.acceptanceCriteria,
      category: parsed.data.category ?? null,
      priority: (parsed.data.priority as CsvRow["priority"]) ?? null,
      stableKey: keyRaw || null,
    });
  });
  // Duplicate explicit keys within the file are row errors, not silent renames.
  const seen = new Map<string, number>();
  for (const r of rows) {
    if (!r.stableKey) continue;
    const first = seen.get(r.stableKey);
    if (first !== undefined) {
      errors.push({ row: r.row, field: "stableKey", message: `Duplicate of row ${first} in this file` });
    } else {
      seen.set(r.stableKey, r.row);
    }
  }
  const badRows = new Set(errors.map((e) => e.row));
  return { rows: rows.filter((r) => !badRows.has(r.row)), errors, totalRows: table.rows.length };
}

export function templateRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use(authenticate(ctx.store));

  // ----- Org template library -----

  router.get(
    "/organizations/:id/scope-templates",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateQuery(z.object({ projectType: z.string().max(80).optional() })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const q = (req as ApiRequest).validatedQuery as { projectType?: string };
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction({ orgRole: membership.role, projectRole: null }, "template.view");
      const templates = await ctx.store.listScopeTemplates(org.id);
      res.json({
        data: q.projectType
          ? templates.filter((t) => t.projectType.toLowerCase() === (q.projectType as string).toLowerCase())
          : templates,
      });
    }),
  );

  router.post(
    "/organizations/:id/scope-templates",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(CreateScopeTemplateSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof CreateScopeTemplateSchema>;
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction({ orgRole: membership.role, projectRole: null }, "template.manage");
      const created = await ctx.store.createScopeTemplate({
        organizationId: org.id,
        name: input.name,
        projectType: input.projectType,
        description: input.description ?? null,
        assumptions: input.assumptions,
        exclusions: input.exclusions,
        items: input.items.map((it) => ({
          title: it.title,
          description: it.description,
          acceptanceCriteria: it.acceptanceCriteria,
          category: it.category ?? null,
          priority: it.priority ?? null,
        })),
        createdBy: auth.user.id,
      });
      await audit(ctx.store, {
        organizationId: org.id,
        projectId: null,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "template.created",
        targetType: "SCOPE_TEMPLATE",
        targetId: created.id,
        after: { name: created.name, projectType: created.projectType },
      });
      res.status(201).json(created);
    }),
  );

  router.patch(
    "/organizations/:id/scope-templates/:templateId",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1), templateId: z.string().min(1) })),
    validateBody(UpdateScopeTemplateSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof UpdateScopeTemplateSchema>;
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction({ orgRole: membership.role, projectRole: null }, "template.manage");
      const existing = await ctx.store.findScopeTemplateById(req.params.templateId as string);
      if (!existing || existing.organizationId !== org.id) throw DomainError.notFound("Template not found");
      const updated = await ctx.store.updateScopeTemplate(existing.id, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.projectType !== undefined ? { projectType: input.projectType } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.assumptions !== undefined ? { assumptions: input.assumptions } : {}),
        ...(input.exclusions !== undefined ? { exclusions: input.exclusions } : {}),
        ...(input.items !== undefined
          ? {
              items: input.items.map((it) => ({
                title: it.title,
                description: it.description,
                acceptanceCriteria: it.acceptanceCriteria,
                category: it.category ?? null,
                priority: it.priority ?? null,
              })),
            }
          : {}),
      });
      await audit(ctx.store, {
        organizationId: org.id,
        projectId: null,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "template.updated",
        targetType: "SCOPE_TEMPLATE",
        targetId: updated.id,
        after: { name: updated.name },
      });
      res.json(updated);
    }),
  );

  router.delete(
    "/organizations/:id/scope-templates/:templateId",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1), templateId: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction({ orgRole: membership.role, projectRole: null }, "template.manage");
      const existing = await ctx.store.findScopeTemplateById(req.params.templateId as string);
      if (!existing || existing.organizationId !== org.id) throw DomainError.notFound("Template not found");
      await ctx.store.deleteScopeTemplate(existing.id);
      await audit(ctx.store, {
        organizationId: org.id,
        projectId: null,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "template.deleted",
        targetType: "SCOPE_TEMPLATE",
        targetId: existing.id,
        before: { name: existing.name },
      });
      res.status(204).send();
    }),
  );

  // ----- Instantiate into a draft scope version -----

  router.post(
    "/projects/:id/scope-versions/draft/from-template",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(InstantiateTemplateSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof InstantiateTemplateSchema>;
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "scope.draft");
      const template = await ctx.store.findScopeTemplateById(input.templateId);
      if (!template || template.organizationId !== access.org.id) throw DomainError.notFound("Template not found");
      const payload = applyTemplate({
        assumptions: template.assumptions,
        exclusions: template.exclusions,
        items: template.items.map((it) => ({
          title: it.title,
          description: it.description,
          acceptanceCriteria: it.acceptanceCriteria,
          category: it.category,
          priority: (["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const).includes(
            (it.priority ?? "") as "LOW",
          )
            ? (it.priority as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL")
            : null,
        })),
      });

      const draft = await ctx.store.transaction(async (tx: Store) => {
        const doc = await tx.createScopeDocument(access.project.id, input.name);
        const created = await tx.createScopeVersion({
          scopeDocumentId: doc.id,
          projectId: access.project.id,
          status: "DRAFT",
          title: template.name,
          summary: template.description,
          assumptions: payload.assumptions,
          exclusions: payload.exclusions,
          version: 0,
          publishedAt: null,
          publishedBy: null,
          createdBy: auth.user.id,
          supersedesId: null,
        });
        const stableKeys: string[] = [];
        for (const [order, item] of payload.items.entries()) {
          const stableKey = await tx.allocateRequirementKey(access.project.id);
          const requirement = await tx.createRequirement(access.project.id, stableKey);
          await tx.upsertRevision({
            requirementId: requirement.id,
            scopeVersionId: created.id,
            title: item.title,
            description: item.description,
            acceptanceCriteria: item.acceptanceCriteria,
            category: item.category ?? null,
            priority: item.priority ?? null,
            order,
          });
          stableKeys.push(stableKey);
        }
        return { draft: await tx.findScopeVersionById(created.id), stableKeys };
      });
      if (!draft.draft) throw DomainError.notFound("Draft not found");
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "scope.draft_from_template",
        targetType: "SCOPE_VERSION",
        targetId: draft.draft.id,
        after: { templateId: template.id, templateName: template.name, requirements: draft.stableKeys.length },
      });
      res.status(201).json({ draft: draft.draft, stableKeys: draft.stableKeys });
    }),
  );

  // ----- CSV import (dry-run preview or atomic import) -----

  router.post(
    "/projects/:id/requirements/import",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateBody(CsvImportSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof CsvImportSchema>;
      const access = await requireProjectAccess(ctx.store, auth.user.id, req.params.id as string);
      requireAction(access.access, "scope.draft");
      const draft = await ctx.store.findScopeVersionById(input.draftVersionId);
      if (!draft || draft.projectId !== access.project.id) throw DomainError.notFound("Draft version not found");
      if (draft.status !== "DRAFT") throw DomainError.unprocessable("Imports target a draft version only");

      let parsed: { rows: CsvRow[]; errors: RowError[]; totalRows: number };
      try {
        parsed = parseRequirementCsv(input.csv);
      } catch (err) {
        if (err instanceof CsvParseError) throw DomainError.unprocessable(err.message);
        throw err;
      }
      // Explicit keys must not collide with keys already used in the project.
      if (parsed.rows.some((r) => r.stableKey)) {
        const existing = new Set((await ctx.store.listRequirements(access.project.id)).map((r) => r.stableKey));
        for (const r of parsed.rows) {
          if (r.stableKey && existing.has(r.stableKey)) {
            parsed.errors.push({ row: r.row, field: "stableKey", message: `${r.stableKey} is already used in this project` });
          }
        }
      }
      const badRows = new Set(parsed.errors.map((e) => e.row));
      const valid = parsed.rows.filter((r) => !badRows.has(r.row));
      if (input.dryRun || parsed.errors.length > 0) {
        const preview = CsvImportResponseSchema.parse({
          dryRun: true,
          totalRows: parsed.totalRows,
          validRows: valid.length,
          imported: 0,
          errors: parsed.errors,
          stableKeys: [],
        });
        res.status(input.dryRun ? 200 : 422).json(preview);
        return;
      }
      const stableKeys = await ctx.store.transaction(async (tx: Store) => {
        const keys: string[] = [];
        // Allocate explicit-or-minted keys in row order for a stable mapping.
        for (const [order, row] of valid.entries()) {
          const stableKey = row.stableKey ?? (await tx.allocateRequirementKey(access.project.id));
          const requirement = await tx.createRequirement(access.project.id, stableKey);
          await tx.upsertRevision({
            requirementId: requirement.id,
            scopeVersionId: draft.id,
            title: row.title,
            description: row.description,
            acceptanceCriteria: row.acceptanceCriteria,
            category: row.category,
            priority: row.priority,
            order,
          });
          keys.push(stableKey);
        }
        await tx.updateScopeVersion(draft.id, { version: draft.version + 1 });
        return keys;
      });
      await audit(ctx.store, {
        organizationId: access.org.id,
        projectId: access.project.id,
        actorId: auth.user.id,
        actorEmail: auth.user.email,
        action: "requirement.imported",
        targetType: "SCOPE_VERSION",
        targetId: draft.id,
        after: { imported: stableKeys.length },
      });
      res.status(201).json(
        CsvImportResponseSchema.parse({
          dryRun: false,
          totalRows: parsed.totalRows,
          validRows: valid.length,
          imported: stableKeys.length,
          errors: [],
          stableKeys,
        }),
      );
    }),
  );

  return router;
}

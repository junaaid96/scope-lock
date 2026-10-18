import { Router } from "express";
import { z } from "zod";
import { MemorySearchQuerySchema } from "@scopelock/contracts";
import { buildExcerpt, DomainError } from "@scopelock/domain";
import type { AppContext } from "../app-context.js";
import { asyncHandler } from "../http/errors.js";
import { authenticate, requireAuth } from "../http/auth.js";
import { requireOrgAccess } from "../http/access.js";
import { validateParams, validateQuery } from "../http/validate.js";
import type { ApiRequest } from "../http/types.js";
import { OpenAiEmbeddings } from "../lib/embeddings.js";
import { logger } from "../logger.js";
import type { PastDecision } from "../store/index.js";

export function memoryRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use(authenticate(ctx.store));

  router.get(
    "/organizations/:id/memory/search",
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    validateQuery(MemorySearchQuerySchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const q = (req as ApiRequest).validatedQuery as { q: string; limit: number };
      const { org, membership } = await requireOrgAccess(ctx.store, auth.user.id, req.params.id as string);

      // Access BEFORE ranking: candidates come only from projects the
      // requester can see. Org operators see every org project; everyone
      // else sees their own memberships.
      const allProjects = await ctx.store.listProjects(org.id);
      let projectIds: string[];
      if (membership.role === "OWNER" || membership.role === "ADMIN") {
        projectIds = allProjects.map((p) => p.id);
      } else {
        const mine = new Set(await ctx.store.listProjectIdsForUser(auth.user.id));
        projectIds = allProjects.map((p) => p.id).filter((id) => mine.has(id));
      }
      if (projectIds.length === 0) {
        res.json({ query: q.q, mode: "lexical", data: [] });
        return;
      }

      let mode: "lexical" | "semantic" = "lexical";
      let rows: PastDecision[] = [];
      // Semantic ranking only when an embeddings provider is configured;
      // any provider hiccup falls through to lexical — search never fails
      // just because embeddings are unavailable.
      if (OpenAiEmbeddings.isConfigured(ctx.env)) {
        try {
          const [vector] = await OpenAiEmbeddings.embed(ctx.env, [q.q]);
          if (vector) {
            const semantic = await ctx.store.searchPastDecisionsSemantic(projectIds, vector, q.limit);
            if (semantic.length > 0) {
              mode = "semantic";
              rows = semantic;
            }
          }
        } catch (err) {
          logger.warn("Memory search fell back to lexical", { error: err instanceof Error ? err.message : String(err) });
        }
      }
      if (rows.length === 0) {
        rows = await ctx.store.searchPastDecisionsLexical(projectIds, q.q, q.limit);
      }

      const names = new Map(allProjects.map((p) => [p.id, p.name]));
      res.json({
        query: q.q,
        mode,
        data: rows.map((r) => ({
          approvalId: r.approvalId,
          projectId: r.projectId,
          projectName: names.get(r.projectId) ?? "Project",
          changeId: r.changeId,
          changeNumber: r.changeNumber,
          title: r.title,
          outcome: r.outcome,
          decidedAt: r.decidedAt,
          excerpt: buildExcerpt(r.text, q.q),
          link: r.changeId ? `/projects/${r.projectId}/changes/${r.changeId}` : `/projects/${r.projectId}`,
        })),
      });
    }),
  );

  return router;
}

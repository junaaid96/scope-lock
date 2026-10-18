import { Router } from "express";
import { z } from "zod";
import {
  DomainError,
  aggregatePolicy,
  buildCertificateModel,
  certificateFilename,
  verifyPackageChecksum,
  type CertificateInput,
} from "@scopelock/domain";
import type { AppContext } from "../app-context.js";
import { asyncHandler } from "../http/errors.js";
import { authenticate } from "../http/auth.js";
import { requireAction, requireProjectAccess } from "../http/access.js";
import { validateParams } from "../http/validate.js";
import { rateLimit } from "../http/rate-limit.js";
import type { ApiRequest } from "../http/types.js";
import type { ApprovalRequest } from "../store/index.js";
import { approverKey, decisionVote, loadTokenPackage } from "./approvals.js";
import { qrCodePng, renderCertificatePdf } from "../lib/change-order.js";

async function loadByRef(
  ctx: AppContext,
  auth: ApiRequest["auth"],
  ref: string,
): Promise<ApprovalRequest> {
  if (auth) {
    const byId = await ctx.store.findApprovalById(ref);
    if (byId) {
      const access = await requireProjectAccess(ctx.store, auth.user.id, byId.projectId);
      requireAction(access.access, "approval.view");
      return byId;
    }
  }
  return (await loadTokenPackage(ctx, ref)).approval;
}

async function certificateInput(ctx: AppContext, approval: ApprovalRequest): Promise<CertificateInput> {
  const [decisions, tokens] = await Promise.all([
    ctx.store.listDecisions(approval.id),
    ctx.store.listApprovalTokens(approval.id),
  ]);
  const pkg = approval.package;
  const options = pkg.options ?? [];
  const outcome =
    approval.status === "DECIDED"
      ? aggregatePolicy(
          approval.policy,
          tokens.map((t) => approverKey(t.approverUserId, t.approverEmail ?? "")),
          decisions.map(decisionVote),
        ).state
      : null;
  const kind = approval.allowancePoolId
    ? "ALLOWANCE"
    : approval.bundleId
      ? "BUNDLE"
      : approval.acceptanceRequirementIds.length > 0
        ? "ACCEPTANCE"
        : "CHANGE";
  return {
    title: approval.title,
    status: approval.status,
    checksum: approval.checksum,
    kind,
    headline: pkg.request
      ? `${pkg.request.number} ${pkg.request.title}`
      : (pkg.members.map((m) => m.number).join(", ") || approval.title || "Review package"),
    description: pkg.request?.description ?? null,
    impact: pkg.impact
      ? {
          effortDays: pkg.impact.effortDays,
          priceMinor: pkg.impact.priceMinor,
          currency: pkg.impact.currency,
          timelineDays: pkg.impact.timelineDays,
        }
      : null,
    options: options.map((o) => ({
      label: o.label,
      priceMinor: o.priceMinor,
      currency: o.currency,
      effortDays: o.effortDays,
      timelineDays: o.timelineDays,
      chosen: approval.chosenOptionId === o.optionId,
    })),
    decisions: decisions.map((d) => ({
      verdict: d.decision,
      comment: d.comment,
      approver: d.approverEmail ?? d.approverUserId ?? "Approver",
      typedName: d.typedName,
      optionLabel: d.optionId ? (options.find((o) => o.optionId === d.optionId)?.label ?? null) : null,
      decidedAt: d.createdAt,
    })),
    outcome,
    sentAt: pkg.sentAt,
    expiresAt: approval.expiresAt,
    verifyUrl: `${ctx.env.WEB_URL}/verify/${approval.id}`,
    deliverables: (pkg.acceptance?.requirements ?? []).map((r) => ({ stableKey: r.stableKey, title: r.title })),
  };
}

export function changeOrderRoutes(ctx: AppContext): Router {
  const router = Router();

  router.get(
    "/approval-requests/:ref/pdf",
    authenticate(ctx.store),
    rateLimit(ctx.env, "token"),
    validateParams(z.object({ ref: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      const approval = await loadByRef(ctx, auth, req.params.ref as string);
      if (approval.status !== "SENT" && approval.status !== "DECIDED" && approval.status !== "DEEMED") {
        throw DomainError.conflict(`A change order is only available for open, decided, or deemed packages (this one is ${approval.status})`, {
          status: approval.status,
        });
      }
      const input = await certificateInput(ctx, approval);
      const model = buildCertificateModel(input);
      const pdf = await renderCertificatePdf(model, await qrCodePng(model.verifyUrl));
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${certificateFilename(approval.id)}"`);
      res.setHeader("Content-Length", String(pdf.length));
      res.status(200).end(pdf);
    }),
  );

  // Public decision certificate: recompute the checksum over the stored bytes
  // and report match/mismatch. Exposes exactly what a review-link holder
  // already sees (package + its decisions) — no org, project, or user records.
  router.get(
    "/verify/:approvalId",
    rateLimit(ctx.env, "token"),
    validateParams(z.object({ approvalId: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const approval = await ctx.store.findApprovalById(req.params.approvalId as string);
      if (!approval) throw DomainError.notFound("Certificate not found");
      const decisions = await ctx.store.listDecisions(approval.id);
      const { recomputed, match } = verifyPackageChecksum(approval.package, approval.checksum);
      const options = approval.package.options ?? [];
      res.json({
        approval: {
          id: approval.id,
          title: approval.title,
          status: approval.status,
          checksum: approval.checksum,
          sentAt: approval.package.sentAt,
          expiresAt: approval.expiresAt,
        },
        package: approval.package,
        decisions: decisions.map((d) => ({
          decision: d.decision,
          comment: d.comment,
          approverEmail: d.approverEmail,
          typedName: d.typedName,
          optionLabel: d.optionId ? (options.find((o) => o.optionId === d.optionId)?.label ?? null) : null,
          createdAt: d.createdAt,
        })),
        recomputedChecksum: recomputed,
        match,
      });
    }),
  );

  return router;
}

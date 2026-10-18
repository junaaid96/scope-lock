import {
  ApprovalTransitions,
  POLICY_ACTOR,
  RequirementTransitions,
  assertTransition,
  currentTurn,
  deemedAcceptanceDays,
  escalationTarget,
  isAcceptancePackage,
  isDeemedDue,
  isEscalationDue,
} from "@scopelock/domain";
import type { Env } from "../env.js";
import type { RealtimeDriver } from "./realtime.js";
import type { EmailDriver } from "./email.js";
import type { StorageDriver } from "./storage.js";
import type { Store } from "../store/index.js";
import { currentPeriod, nowIso } from "../store/index.js";
import { logger } from "../logger.js";

const MAX_ATTEMPTS = 8;
const BATCH = 25;

function backoffMs(attempts: number): number {
  return Math.min(30 * 60 * 1000, 5_000 * 2 ** attempts) + Math.floor(Math.random() * 1000);
}

export interface WorkerDeps {
  store: Store;
  env: Env;
  email: EmailDriver;
  realtime: RealtimeDriver;
  /** When present, retention GC purges stale upload bytes. */
  storage?: StorageDriver;
}

async function deliverOutbox(deps: WorkerDeps): Promise<{ delivered: number; failed: number }> {
  const { store, email, realtime } = deps;
  const batch = await store.claimOutboxBatch(BATCH, nowIso());
  let delivered = 0;
  let failed = 0;
  for (const event of batch) {
    try {
      if (event.type === "EMAIL") {
        const p = event.payload as { to: string; subject: string; text: string; organizationId?: string };
        await email.send({ to: p.to, subject: p.subject, text: p.text });
        if (p.organizationId) {
          await store.bumpUsage(p.organizationId, currentPeriod(), { emailsSent: 1 }).catch(() => undefined);
        }
      } else {
        const p = event.payload as { channel: string; event: string; title?: string; link?: string | null };
        await realtime.publish(p.channel, p.event, { title: p.title ?? "", link: p.link ?? null });
      }
      await store.updateOutbox(event.id, { status: "SENT", attempts: event.attempts + 1, lastError: null });
      delivered++;
    } catch (err) {
      const attempts = event.attempts + 1;
      const dead = attempts >= MAX_ATTEMPTS;
      await store.updateOutbox(event.id, {
        status: dead ? "DEAD" : "FAILED",
        attempts,
        lastError: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
        nextRunAt: new Date(Date.now() + backoffMs(attempts)).toISOString(),
      });
      failed++;
      logger.warn("Outbox delivery failed", { outboxId: event.id, attempts, dead });
    }
  }
  return { delivered, failed };
}

/** Expire overdue SENT approvals, deem overdue acceptance, escalate stalled packages, and queue reminders per project settings. */
async function processApprovalDeadlines(deps: WorkerDeps): Promise<{ expired: number; deemed: number; escalated: number; reminders: number }> {
  const { store } = deps;
  const now = nowIso();
  let expired = 0;
  let deemed = 0;
  let escalated = 0;
  let reminders = 0;

  for (const approval of await store.listUnescalatedSentApprovals()) {
    const project = await store.findProjectById(approval.projectId);
    if (!project) continue;
    if (!isEscalationDue({ status: approval.status, escalatedAt: approval.escalatedAt, sentAt: approval.sentAt, nowIso: now, settings: project.settings })) {
      continue;
    }
    if (await escalateApproval(deps, approval.id, now)) escalated++;
  }

  for (const approval of await store.listExpiredPendingApprovals(now)) {
    // Acceptance past its deadline with a configured window is deemed
    // accepted by policy instead of expiring.
    if (isAcceptancePackage(approval)) {
      const project = await store.findProjectById(approval.projectId);
      if (project && isDeemedDue({ status: approval.status, expiresAt: approval.expiresAt, nowIso: now, settings: project.settings })) {
        if (await deemAcceptance(deps, approval.id, now)) deemed++;
        continue;
      }
    }
    await store.transaction(async (tx) => {
      const fresh = await tx.findApprovalById(approval.id);
      if (!fresh || fresh.status !== "SENT") return;
      assertTransition(ApprovalTransitions, fresh.status, "EXPIRED", "approval");
      await tx.updateApproval(fresh.id, { status: "EXPIRED", version: fresh.version + 1 });
      const project = await tx.findProjectById(fresh.projectId);
      if (project) {
        await tx.appendAuditEvent({
          organizationId: project.organizationId,
          projectId: fresh.projectId,
          actorId: null,
          actorEmail: null,
          action: "approval.expired",
          targetType: "APPROVAL",
          targetId: fresh.id,
          before: { status: "SENT" },
          after: { status: "EXPIRED" },
          correlationId: `worker-${Date.now()}`,
          ip: null,
        });
        const members = await tx.listProjectMembers(fresh.projectId);
        for (const m of members) {
          if (m.role !== "LEAD" && m.role !== "MEMBER") continue;
          const user = await tx.findUserById(m.userId);
          if (!user) continue;
          await tx.createNotification({
            userId: m.userId,
            projectId: fresh.projectId,
            type: "APPROVAL_EXPIRED",
            title: "An approval request expired",
            body: `“${fresh.title ?? "Review package"}” expired without a decision. Resend or withdraw it.`,
            link: fresh.changeRequestId ? `/projects/${fresh.projectId}/changes/${fresh.changeRequestId}` : null,
          });
          await tx.enqueueOutbox({
            type: "EMAIL",
            payload: {
              to: user.email,
              subject: "An approval request expired",
              text: `The review package for project ${project.name} expired without a decision.`,
              organizationId: project.organizationId,
              projectId: fresh.projectId,
              notificationType: "APPROVAL_EXPIRED",
            },
            idempotencyKey: `expired:${fresh.id}:${m.userId}`,
          });
        }
      }
      expired++;
    });
  }

  for (const approval of await store.listApprovalsForReminders(now)) {
    const project = await store.findProjectById(approval.projectId);
    if (!project || !approval.expiresAt) continue;
    const hoursLeft = (Date.parse(approval.expiresAt) - Date.parse(now)) / 3_600_000;
    const due = project.settings.reminderHoursBeforeExpiry.filter(
      (h) => hoursLeft <= h && !approval.remindersSent.includes(h),
    );
    if (due.length === 0) continue;
    await store.transaction(async (tx) => {
      const fresh = await tx.findApprovalById(approval.id);
      if (!fresh || fresh.status !== "SENT") return;
      const acceptance = isAcceptancePackage(fresh);
      const deemedOn = acceptance && deemedAcceptanceDays(project.settings) !== null;
      const hours = Math.max(1, Math.round(hoursLeft));
      const title = acceptance ? "Reminder: deliverables awaiting your acceptance" : "Reminder: a proposal needs your decision";
      const body = acceptance
        ? `“${fresh.title ?? "Delivery acceptance"}” ${deemedOn ? `is deemed accepted in ${hours}h without objection` : `expires in ${hours}h`}.`
        : `“${fresh.title ?? "Review package"}” expires in ${hours}h.`;
      const tokens = await tx.listApprovalTokens(fresh.id);
      for (const token of tokens) {
        if (token.revokedAt) continue;
        const recipient = token.approverUserId
          ? await tx.findUserById(token.approverUserId)
          : null;
        const email = recipient?.email ?? token.approverEmail;
        if (recipient) {
          await tx.createNotification({
            userId: recipient.id,
            projectId: fresh.projectId,
            type: "APPROVAL_REMINDER",
            title,
            body,
            link: `/inbox`,
          });
        }
        if (email) {
          await tx.enqueueOutbox({
            type: "EMAIL",
            payload: {
              to: email,
              subject: title,
              text: acceptance
                ? `The delivered work “${fresh.title ?? ""}” ${deemedOn ? `is deemed accepted in ${hours}h without objection` : `expires in ${hours}h`}. Review it from your inbox.`
                : `The review package “${fresh.title ?? ""}” expires in ${hours}h.`,
              organizationId: project.organizationId,
              projectId: fresh.projectId,
              notificationType: "APPROVAL_REMINDER",
            },
            idempotencyKey: `reminder:${fresh.id}:${due.join("+")}:${email}`,
          });
        }
      }
      await tx.updateApproval(fresh.id, { remindersSent: [...fresh.remindersSent, ...due] });
      await tx.appendAuditEvent({
        organizationId: project.organizationId,
        projectId: fresh.projectId,
        actorId: null,
        actorEmail: null,
        action: "approval.reminder_sent",
        targetType: "APPROVAL",
        targetId: fresh.id,
        after: { hoursLeft: Math.round(hoursLeft), thresholds: due },
        correlationId: `worker-${Date.now()}`,
        ip: null,
      });
      reminders++;
    });
  }
  return { expired, deemed, escalated, reminders };
}

/** Canonical approver identity (mirrors the review-link layer): user id when known, else lowercased email. */
function escKey(userId: string | null, email: string | null): string {
  return userId ?? (email ?? "").toLowerCase();
}

/**
 * Escalate a stalled package exactly once: nudge whoever still owes a vote,
 * or hand the stall to the agency leads — per the project's target.
 */
async function escalateApproval(deps: WorkerDeps, approvalId: string, now: string): Promise<boolean> {
  const { store } = deps;
  return store.transaction(async (tx) => {
    const fresh = await tx.findApprovalById(approvalId);
    if (!fresh || fresh.status !== "SENT" || fresh.escalatedAt !== null) return false;
    const project = await tx.findProjectById(fresh.projectId);
    if (!project || !isEscalationDue({ status: fresh.status, escalatedAt: fresh.escalatedAt, sentAt: fresh.sentAt, nowIso: now, settings: project.settings })) {
      return false;
    }
    const target = escalationTarget(project.settings);
    const hoursSinceSent = Math.round(((Date.parse(now) - Date.parse(fresh.sentAt as string)) / 3_600_000) * 10) / 10;
    const tokens = await tx.listApprovalTokens(fresh.id);
    const decisions = await tx.listDecisions(fresh.id);
    const voted = new Set(decisions.map((d) => escKey(d.approverUserId, d.approverEmail)));
    const policy = fresh.policy ?? { mode: "ANY" as const, approverOrder: [] as string[] };
    const keys = tokens.map((t) => escKey(t.approverUserId, t.approverEmail));
    const turn = target === "SECOND_APPROVER" && policy.mode === "SEQUENTIAL"
      ? currentTurn(policy, keys, decisions.map((d) => ({ tokenId: d.tokenId, approverKey: escKey(d.approverUserId, d.approverEmail), decision: d.decision })))
      : null;
    const escalatedAt = nowIso();
    await tx.updateApproval(fresh.id, { escalatedAt, version: fresh.version + 1 });
    const notified: string[] = [];
    if (target === "AGENCY_LEAD") {
      for (const m of await tx.listProjectMembers(fresh.projectId)) {
        if (m.role !== "LEAD") continue;
        const user = await tx.findUserById(m.userId);
        if (!user) continue;
        const body = `“${fresh.title ?? "Review package"}” has awaited a decision for ${hoursSinceSent}h. It was escalated to you as the agency lead.`;
        await tx.createNotification({
          userId: user.id,
          projectId: fresh.projectId,
          type: "APPROVAL_ESCALATED",
          title: "Stalled approval escalated to you",
          body,
          link: fresh.changeRequestId ? `/projects/${fresh.projectId}/changes/${fresh.changeRequestId}` : `/projects/${fresh.projectId}`,
        });
        await tx.enqueueOutbox({
          type: "EMAIL",
          payload: {
            to: user.email,
            subject: "Stalled approval escalated to you",
            text: body,
            organizationId: project.organizationId,
            projectId: fresh.projectId,
            notificationType: "APPROVAL_ESCALATED",
          },
          idempotencyKey: `escalated:${fresh.id}:${user.id}`,
        });
        notified.push(user.email);
      }
    } else {
      for (const token of tokens) {
        if (token.revokedAt) continue;
        const key = escKey(token.approverUserId, token.approverEmail);
        if (voted.has(key)) continue;
        if (turn !== null && turn !== key) continue;
        const recipient = token.approverUserId ? await tx.findUserById(token.approverUserId) : null;
        const email = recipient?.email ?? token.approverEmail;
        const body = `“${fresh.title ?? "Review package"}” has awaited a decision for ${hoursSinceSent}h. This is an escalation: please decide now.`;
        if (recipient) {
          await tx.createNotification({
            userId: recipient.id,
            projectId: fresh.projectId,
            type: "APPROVAL_ESCALATED",
            title: "Escalated: your decision is overdue",
            body,
            link: "/inbox",
          });
        }
        if (email) {
          await tx.enqueueOutbox({
            type: "EMAIL",
            payload: {
              to: email,
              subject: "Escalated: your decision is overdue",
              text: `${body}\n\nReview: ${deps.env.WEB_URL}/inbox`,
              organizationId: project.organizationId,
              projectId: fresh.projectId,
              notificationType: "APPROVAL_ESCALATED",
            },
            idempotencyKey: `escalated:${fresh.id}:${key}`,
          });
        }
        notified.push(email ?? key);
      }
    }
    await tx.appendAuditEvent({
      organizationId: project.organizationId,
      projectId: fresh.projectId,
      actorId: null,
      actorEmail: null,
      action: "approval.escalated",
      targetType: "APPROVAL",
      targetId: fresh.id,
      before: { status: "SENT" },
      after: { status: "SENT", escalatedAt, target, hoursSinceSent, notified },
      correlationId: `worker-${Date.now()}`,
      ip: null,
    });
    return true;
  });
}

/**
 * Deem an overdue acceptance package accepted. Recorded with the policy
 * actor — never as a client decision, so no decision row is written.
 */
async function deemAcceptance(deps: WorkerDeps, approvalId: string, now: string): Promise<boolean> {
  const { store } = deps;
  return store.transaction(async (tx) => {
    const fresh = await tx.findApprovalById(approvalId);
    if (!fresh || fresh.status !== "SENT" || !isAcceptancePackage(fresh)) return false;
    const project = await tx.findProjectById(fresh.projectId);
    if (!project || !isDeemedDue({ status: fresh.status, expiresAt: fresh.expiresAt, nowIso: now, settings: project.settings })) {
      return false;
    }
    assertTransition(ApprovalTransitions, fresh.status, "DEEMED", "approval");
    const deemedAt = nowIso();
    await tx.updateApproval(fresh.id, { status: "DEEMED", deemedAt, version: fresh.version + 1 });
    const accepted: string[] = [];
    const skipped: string[] = [];
    for (const reqId of fresh.acceptanceRequirementIds) {
      const req = await tx.findRequirementById(reqId);
      if (!req || req.projectId !== fresh.projectId || req.status !== "DELIVERED") {
        skipped.push(reqId);
        continue;
      }
      assertTransition(RequirementTransitions, req.status, "ACCEPTED", "requirement");
      await tx.updateRequirement(req.id, { status: "ACCEPTED" });
      await tx.appendAuditEvent({
        organizationId: project.organizationId,
        projectId: fresh.projectId,
        actorId: null,
        actorEmail: POLICY_ACTOR,
        action: "requirement.status_changed",
        targetType: "REQUIREMENT",
        targetId: req.id,
        before: { status: req.status },
        after: { status: "ACCEPTED", actor: POLICY_ACTOR, approvalId: fresh.id },
        correlationId: `worker-${Date.now()}`,
        ip: null,
      });
      accepted.push(reqId);
    }
    await tx.appendAuditEvent({
      organizationId: project.organizationId,
      projectId: fresh.projectId,
      actorId: null,
      actorEmail: POLICY_ACTOR,
      action: "acceptance.deemed",
      targetType: "APPROVAL",
      targetId: fresh.id,
      before: { status: "SENT" },
      after: { status: "DEEMED", actor: POLICY_ACTOR, acceptedRequirementIds: accepted, skippedRequirementIds: skipped },
      correlationId: `worker-${Date.now()}`,
      ip: null,
    });
    const keys: string[] = [];
    for (const reqId of accepted) {
      const req = await tx.findRequirementById(reqId);
      if (req) keys.push(req.stableKey);
    }
    const summary = keys.length > 0 ? keys.join(", ") : `${accepted.length} requirement(s)`;
    for (const m of await tx.listProjectMembers(fresh.projectId)) {
      if (m.role !== "LEAD" && m.role !== "MEMBER" && m.role !== "CLIENT_ADMIN" && m.role !== "CLIENT_APPROVER") continue;
      const user = await tx.findUserById(m.userId);
      if (!user) continue;
      const body = `“${fresh.title ?? "Delivery acceptance"}” (${summary}) passed its deadline without objection and is now deemed accepted by policy. No client decision was recorded.`;
      await tx.createNotification({
        userId: m.userId,
        projectId: fresh.projectId,
        type: "ACCEPTANCE_DEEMED",
        title: "Deliverables deemed accepted",
        body,
        link: `/projects/${fresh.projectId}/scope`,
      });
      await tx.enqueueOutbox({
        type: "EMAIL",
        payload: {
          to: user.email,
          subject: "Deliverables deemed accepted",
          text: body,
          organizationId: project.organizationId,
          projectId: fresh.projectId,
          notificationType: "ACCEPTANCE_DEEMED",
        },
        idempotencyKey: `deemed:${fresh.id}:${m.userId}`,
      });
    }
    return true;
  });
}

/**
 * Retention GC. Abandoned PENDING intents past PENDING_UPLOAD_TTL_HOURS are
 * expired (bytes removed, metadata marked DELETED); DELETED rows past
 * DELETED_FILE_PURGE_DAYS have their bytes purged while metadata stays for
 * the audit trail. READY files are never auto-deleted.
 */
async function gcAttachments(deps: WorkerDeps): Promise<{ purged: number }> {
  if (!deps.storage) return { purged: 0 };
  const now = Date.now();
  const pendingBefore = new Date(now - deps.env.PENDING_UPLOAD_TTL_HOURS * 3_600_000).toISOString();
  const deletedBefore = new Date(now - deps.env.DELETED_FILE_PURGE_DAYS * 86_400_000).toISOString();
  const stale = await deps.store.listAttachmentsForGc(pendingBefore, deletedBefore);
  let purged = 0;
  for (const a of stale) {
    await deps.storage.deleteBytes(a.storageKey).catch(() => undefined);
    if (a.status === "PENDING") {
      const project = await deps.store.findProjectById(a.projectId);
      if (!project) continue;
      await deps.store.updateAttachment(a.id, { status: "DELETED" });
      await deps.store.appendAuditEvent({
        organizationId: project.organizationId,
        projectId: a.projectId,
        actorId: null,
        actorEmail: null,
        action: "attachment.intent_expired",
        targetType: "ATTACHMENT",
        targetId: a.id,
        before: { status: "PENDING" },
        after: { status: "DELETED", reason: "upload intent expired without bytes" },
        correlationId: `worker-${Date.now()}`,
        ip: null,
      });
    }
    purged++;
  }
  return { purged };
}

/** Single drain pass: outbox delivery + approval deadlines + retention GC. Safe to call on an interval. */
export async function drainOnce(deps: WorkerDeps): Promise<void> {
  const outbox = await deliverOutbox(deps);
  const deadlines = await processApprovalDeadlines(deps);
  const gc = await gcAttachments(deps);
  if (outbox.delivered + outbox.failed + deadlines.expired + deadlines.reminders + gc.purged > 0) {
    logger.info("Worker drain completed", { ...outbox, ...deadlines, ...gc });
  }
}

/** Background interval for long-lived servers. Disabled when OUTBOX_AUTODRAIN=false. */
export function startWorker(deps: WorkerDeps, intervalMs = 15_000): () => void {
  if (!deps.env.OUTBOX_AUTODRAIN || deps.env.NODE_ENV === "test") return () => undefined;
  const timer = setInterval(() => {
    drainOnce(deps).catch((err) => logger.error("Worker drain failed", { message: String(err) }));
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

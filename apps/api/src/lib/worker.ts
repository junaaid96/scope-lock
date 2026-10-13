import { assertTransition, ApprovalTransitions } from "@scopelock/domain";
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

/** Expire overdue SENT approvals and queue reminders per project settings. */
async function processApprovalDeadlines(deps: WorkerDeps): Promise<{ expired: number; reminders: number }> {
  const { store } = deps;
  const now = nowIso();
  let expired = 0;
  let reminders = 0;

  for (const approval of await store.listExpiredPendingApprovals(now)) {
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
            title: "Reminder: a proposal needs your decision",
            body: `“${fresh.title ?? "Review package"}” expires in ${Math.max(1, Math.round(hoursLeft))}h.`,
            link: `/inbox`,
          });
        }
        if (email) {
          await tx.enqueueOutbox({
            type: "EMAIL",
            payload: {
              to: email,
              subject: "Reminder: a proposal needs your decision",
              text: `The review package “${fresh.title ?? ""}” expires in ${Math.max(1, Math.round(hoursLeft))}h.`,
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
  return { expired, reminders };
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

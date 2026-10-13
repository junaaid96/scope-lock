import type { Env } from "../env.js";
import type { Store } from "../store/index.js";
import { currentPeriod, nowIso } from "../store/index.js";
import { logger } from "../logger.js";

export interface NotifyInput {
  userId: string;
  projectId?: string | null;
  organizationId?: string | null;
  type: string;
  title: string;
  body: string;
  link?: string | null;
  email?: { to: string; subject: string; text: string } | null;
}

/**
 * In-app notification (immediate) + email outbox entry (durable, retried).
 * The outbox write happens inside the caller's transaction so a provider outage
 * can never corrupt a completed domain operation.
 */
export async function notify(store: Store, input: NotifyInput): Promise<void> {
  await store.createNotification({
    userId: input.userId,
    projectId: input.projectId ?? null,
    type: input.type,
    title: input.title,
    body: input.body,
    link: input.link ?? null,
  });
  if (input.email && input.organizationId) {
    await store.enqueueOutbox({
      type: "EMAIL",
      payload: {
        to: input.email.to,
        subject: input.email.subject,
        text: input.email.text,
        organizationId: input.organizationId,
        projectId: input.projectId ?? null,
        notificationType: input.type,
      },
      idempotencyKey: null,
    });
  }
  await store.enqueueOutbox({
    type: "REALTIME",
    payload: {
      channel: input.projectId ? `project:${input.projectId}` : `user:${input.userId}`,
      event: input.type,
      projectId: input.projectId ?? null,
      userId: input.userId,
      title: input.title,
      link: input.link ?? null,
    },
    idempotencyKey: null,
  });
}

/** Fan out to every member of a project (used for workflow events). */
export async function notifyProjectMembers(
  store: Store,
  args: {
    projectId: string;
    organizationId: string;
    excludeUserId?: string;
    type: string;
    title: string;
    body: string;
    link?: string | null;
    includeEmail?: boolean;
  },
): Promise<void> {
  const members = await store.listProjectMembers(args.projectId);
  for (const m of members) {
    if (m.userId === args.excludeUserId) continue;
    const user = await store.findUserById(m.userId);
    if (!user) continue;
    await notify(store, {
      userId: m.userId,
      projectId: args.projectId,
      organizationId: args.organizationId,
      type: args.type,
      title: args.title,
      body: args.body,
      link: args.link ?? null,
      email: args.includeEmail ? { to: user.email, subject: args.title, text: args.body } : null,
    });
  }
}

export function periodNow(): string {
  return currentPeriod(new Date(nowIso()));
}

export function logEmailDisabled(env: Env, to: string, subject: string): void {
  if (!env.EMAIL_API_KEY) {
    logger.info("Email driver=log; message recorded in outbox only", { to, subject });
  }
}

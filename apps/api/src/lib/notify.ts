import { isChannelEligible } from "@scopelock/domain";
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
  const user = await store.findUserById(input.userId);
  if (input.email && input.organizationId && user?.notifyEmail !== false) {
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
  // Slack/SMS/WhatsApp fan-out for eligible types. The Slack key is shared
  // across the per-user fan-out so the org channel gets exactly one post.
  await notifyChannels(store, {
    userId: input.userId,
    organizationId: input.organizationId ?? null,
    type: input.type,
    title: input.title,
    body: input.body,
    link: input.link ?? null,
    slackKey: input.organizationId ? `${input.organizationId}:${input.type}:${input.projectId ?? "-"}:${input.title}` : null,
    userKey: null,
  });
}

export interface ChannelFanout {
  userId?: string | null;
  organizationId?: string | null;
  type: string;
  title: string;
  body: string;
  link?: string | null;
  /** Stable per-event key -> one Slack post per event. Null skips dedupe. */
  slackKey?: string | null;
  /** Stable per-recipient key. Null skips dedupe. */
  userKey?: string | null;
}

/**
 * Enqueue Slack/SMS/WhatsApp outbox rows for channel-eligible types.
 * Slack posts to the org's shared channel when configured; SMS/WhatsApp
 * deliver per user, gated on preferences and a stored phone number.
 */
export async function notifyChannels(store: Store, args: ChannelFanout): Promise<void> {
  if (!isChannelEligible(args.type)) return;
  if (args.organizationId) {
    const org = await store.findOrganizationById(args.organizationId);
    if (org?.slackWebhookUrlSealed) {
      await store.enqueueOutbox({
        type: "SLACK",
        payload: {
          organizationId: args.organizationId,
          title: args.title,
          body: args.body,
          link: args.link ?? null,
          notificationType: args.type,
        },
        idempotencyKey: args.slackKey ? `slack:${args.slackKey}` : null,
      });
    }
  }
  if (args.userId) {
    const user = await store.findUserById(args.userId);
    if (user?.phoneE164) {
      const body = `${args.title}\n${args.body}`;
      if (user.notifySms) {
        await store.enqueueOutbox({
          type: "SMS",
          payload: { userId: user.id, body, notificationType: args.type },
          idempotencyKey: args.userKey ? `sms:${args.userKey}` : null,
        });
      }
      if (user.notifyWhatsapp) {
        await store.enqueueOutbox({
          type: "WHATSAPP",
          payload: { userId: user.id, body, notificationType: args.type },
          idempotencyKey: args.userKey ? `wa:${args.userKey}` : null,
        });
      }
    }
  }
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

import { newId, signWebhookPayload, webhookTimestamp, type WebhookEvent } from "@scopelock/domain";
import type { Env } from "../env.js";
import type { OutboxEvent, Store, WebhookDeliveryStatus } from "../store/index.js";
import { unsealSecret } from "./mfa.js";
import { assertSafeWebhookUrl, webhookSsrfPolicy } from "./ssrf.js";

const DELIVERY_TIMEOUT_MS = 10_000;

/** Package kind for webhook payloads (mirrors the certificate classifier). */
export function approvalKindOf(approval: {
  allowancePoolId: string | null;
  bundleId: string | null;
  acceptanceRequirementIds: string[];
}): "CHANGE" | "BUNDLE" | "ALLOWANCE" | "ACCEPTANCE" {
  if (approval.allowancePoolId) return "ALLOWANCE";
  if (approval.bundleId) return "BUNDLE";
  if (approval.acceptanceRequirementIds.length > 0) return "ACCEPTANCE";
  return "CHANGE";
}

/**
 * Fan out one occurrence to every enabled subscription of the organization
 * listening to the event. Call inside the triggering transaction: the
 * deliveries commit atomically with the occurrence and its audit event.
 * The occurrenceKey dedupes retried triggers (one delivery per subscription).
 */
export async function emitWebhookEvent(
  store: Store,
  input: { organizationId: string; event: WebhookEvent; occurrenceKey: string; data: Record<string, unknown> },
): Promise<void> {
  const subs = (await store.listWebhooks(input.organizationId)).filter((s) => s.enabled && s.events.includes(input.event));
  for (const sub of subs) {
    const body = { id: newId("whe"), event: input.event, occurredAt: new Date().toISOString(), data: input.data };
    await store.enqueueOutbox({
      type: "WEBHOOK",
      payload: { subscriptionId: sub.id, body },
      idempotencyKey: `webhook:${input.event}:${input.occurrenceKey}:${sub.id}`,
    });
  }
}

interface WebhookPayload {
  subscriptionId: string;
  body: { id: string; event: string; occurredAt: string; data: Record<string, unknown> };
}

async function recordDelivery(
  store: Store,
  outbox: OutboxEvent,
  patch: {
    subscriptionId: string;
    event: string;
    body: Record<string, unknown>;
    status: WebhookDeliveryStatus;
    responseStatus: number | null;
    lastError: string | null;
  },
): Promise<void> {
  const existing = await store.findWebhookDeliveryByOutboxId(outbox.id);
  if (existing) {
    await store.updateWebhookDelivery(existing.id, {
      status: patch.status,
      attempts: outbox.attempts + 1,
      responseStatus: patch.responseStatus,
      lastError: patch.lastError,
    });
    return;
  }
  await store.createWebhookDelivery({
    subscriptionId: patch.subscriptionId,
    outboxEventId: outbox.id,
    event: patch.event,
    status: patch.status,
    attempts: outbox.attempts + 1,
    requestBody: patch.body as Record<string, unknown>,
    responseStatus: patch.responseStatus,
    lastError: patch.lastError,
  });
}

/**
 * Deliver one WEBHOOK outbox row: resolve the subscription, re-screen the
 * URL (DNS may have changed since subscribing), sign, POST, and log.
 * Throws on failure so the generic outbox path applies backoff/DEAD.
 */
export async function deliverWebhookEvent(deps: { store: Store; env: Env }, outbox: OutboxEvent): Promise<void> {
  const { store, env } = deps;
  const payload = outbox.payload as unknown as Partial<WebhookPayload>;
  const subscriptionId = typeof payload.subscriptionId === "string" ? payload.subscriptionId : null;
  const body = payload.body;
  if (!subscriptionId || !body || typeof body !== "object") {
    throw new Error("webhook outbox payload is malformed");
  }
  const sub = await store.findWebhookById(subscriptionId);
  if (!sub) {
    await recordDelivery(store, outbox, {
      subscriptionId,
      event: typeof body.event === "string" ? body.event : "unknown",
      body: body as Record<string, unknown>,
      status: "DEAD",
      responseStatus: null,
      lastError: "subscription deleted",
    });
    return; // Drop: no receiver, no retry.
  }
  if (!sub.enabled) {
    await recordDelivery(store, outbox, {
      subscriptionId,
      event: typeof body.event === "string" ? body.event : "unknown",
      body: body as Record<string, unknown>,
      status: "DEAD",
      responseStatus: null,
      lastError: "subscription disabled",
    });
    return;
  }
  const secret = unsealSecret(env.AUTH_SECRET, sub.secretSealed);
  if (!secret) throw new Error("webhook secret cannot be decrypted");
  const url = await assertSafeWebhookUrl(sub.url, webhookSsrfPolicy(env.NODE_ENV));
  const rawBody = JSON.stringify(body);
  const timestamp = webhookTimestamp();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-scopelock-event": typeof body.event === "string" ? body.event : "unknown",
        "x-scopelock-timestamp": timestamp,
        "x-scopelock-signature": signWebhookPayload(secret, timestamp, rawBody),
      },
      body: rawBody,
      signal: controller.signal,
    });
    if (!res.ok) {
      await recordDelivery(store, outbox, {
        subscriptionId,
        event: typeof body.event === "string" ? body.event : "unknown",
        body: body as Record<string, unknown>,
        status: "FAILED",
        responseStatus: res.status,
        lastError: `receiver responded ${res.status}`,
      });
      throw new Error(`webhook receiver responded ${res.status}`);
    }
    await recordDelivery(store, outbox, {
      subscriptionId,
      event: typeof body.event === "string" ? body.event : "unknown",
      body: body as Record<string, unknown>,
      status: "SENT",
      responseStatus: res.status,
      lastError: null,
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("webhook receiver responded")) throw err;
    const message = err instanceof Error ? (err.name === "AbortError" ? "delivery timed out after 10s" : err.message) : String(err);
    await recordDelivery(store, outbox, {
      subscriptionId,
      event: typeof body.event === "string" ? body.event : "unknown",
      body: body as Record<string, unknown>,
      status: "FAILED",
      responseStatus: null,
      lastError: message.slice(0, 500),
    });
    throw err instanceof Error ? err : new Error(message);
  } finally {
    clearTimeout(timer);
  }
}

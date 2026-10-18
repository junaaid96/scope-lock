import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Outgoing webhook signing. Every delivery POSTs JSON with:
 * - `X-ScopeLock-Event`: the event name,
 * - `X-ScopeLock-Timestamp`: unix seconds when the signature was computed,
 * - `X-ScopeLock-Signature`: `v1=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>`.
 *
 * Receivers recompute the HMAC over the raw bytes and reject timestamps
 * outside their tolerance (replay protection).
 */

export const WEBHOOK_EVENTS = [
  "approval.sent",
  "approval.decided",
  "approval.expired",
  "approval.escalated",
  "acceptance.deemed",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function isWebhookEvent(value: string): value is WebhookEvent {
  return (WEBHOOK_EVENTS as readonly string[]).includes(value);
}

export function signWebhookPayload(secret: string, timestamp: string, rawBody: string): string {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
}

export function verifyWebhookSignature(secret: string, timestamp: string, rawBody: string, signature: string): boolean {
  const expected = signWebhookPayload(secret, timestamp, rawBody);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Unix-seconds timestamp header value for an outgoing delivery. */
export function webhookTimestamp(now: Date = new Date()): string {
  return Math.floor(now.getTime() / 1000).toString();
}

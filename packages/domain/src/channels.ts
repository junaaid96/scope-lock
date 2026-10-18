// Notification channels: which events may leave the app, and how personal
// delivery preferences validate. Slack posts to a shared org channel;
// SMS/WhatsApp deliver per user to a verified E.164 phone number.

/** Notification types eligible for Slack/SMS/WhatsApp fan-out. */
export const CHANNEL_ELIGIBLE_TYPES = [
  "APPROVAL_REQUESTED",
  "APPROVAL_DECIDED",
  "APPROVAL_ESCALATED",
  "APPROVAL_EXPIRED",
  "APPROVAL_REMINDER",
  "ACCEPTANCE_DEEMED",
] as const;

export function isChannelEligible(type: string): boolean {
  return (CHANNEL_ELIGIBLE_TYPES as readonly string[]).includes(type);
}

/**
 * Normalize a phone number to strict E.164. Common separators are stripped;
 * anything that is not `+` followed by 7–15 digits is rejected (null).
 */
export function normalizePhoneE164(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const stripped = input.trim().replace(/[\s\-().]/g, "");
  if (!/^\+[1-9]\d{6,14}$/.test(stripped)) return null;
  return stripped;
}

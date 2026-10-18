import { z } from "zod";
import { IdSchema, LocaleSchema } from "./common.js";

// ---------- Notification channels ----------

export const UpdateNotificationPreferencesSchema = z.object({
  /** E.164 phone for SMS/WhatsApp; null clears it. Format-checked in domain. */
  phoneE164: z.string().max(20).nullable().optional(),
  notifyEmail: z.boolean().optional(),
  notifySms: z.boolean().optional(),
  notifyWhatsapp: z.boolean().optional(),
  locale: LocaleSchema.optional(),
});

export const NotificationPreferencesViewSchema = z.object({
  userId: IdSchema,
  phoneE164: z.string().nullable(),
  notifyEmail: z.boolean(),
  notifySms: z.boolean(),
  notifyWhatsapp: z.boolean(),
  locale: LocaleSchema,
});

export const UpdateOrgSlackSchema = z.object({
  /** Incoming-webhook URL; null disconnects. SSRF-screened server-side. */
  slackWebhookUrl: z.string().url().max(2000).nullable(),
});

import { z } from "zod";
import { IsoDateSchema } from "./common.js";

// ---------- API keys ----------

/**
 * Key scopes are policy actions (plus "*" for everything the creator could
 * do). Mirrors domain ACTIONS; parity is asserted in the API contract tests.
 */
export const ApiKeyScopeSchema = z.enum([
  "org.view",
  "org.manage",
  "org.invite",
  "org.members.manage",
  "org.usage.view",
  "org.branding.manage",
  "client.manage",
  "project.create",
  "project.view",
  "project.manage",
  "project.members.manage",
  "scope.view",
  "scope.draft",
  "scope.publish",
  "requirement.status",
  "change.submit",
  "acceptance.send",
  "change.triage",
  "change.estimate",
  "change.send",
  "change.implement",
  "change.convert",
  "approval.view",
  "approval.decide",
  "bundle.manage",
  "note.create",
  "evidence.attach",
  "evidence.verify",
  "file.upload",
  "file.download",
  "ai.use",
  "ai.review",
  "activity.view",
  "health.view",
  "export.read",
  "external.manage",
  "ratecard.view",
  "ratecard.manage",
  "template.view",
  "template.manage",
  "allowance.manage",
  "allowance.object",
  "intake.manage",
  "notifications.view",
  "*",
]);

export const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(80),
  scopes: z.array(ApiKeyScopeSchema).min(1).max(45),
  /** Omit for a never-expiring key; prefer short-lived keys. */
  expiresAt: IsoDateSchema.nullable().optional(),
});

export const ApiKeyViewSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  prefix: z.string(),
  scopes: z.array(z.string()),
  expiresAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
});

// ---------- Outgoing webhooks ----------

/** Mirrors domain WEBHOOK_EVENTS; parity is asserted in the API contract tests. */
export const WebhookEventSchema = z.enum([
  "approval.sent",
  "approval.decided",
  "approval.expired",
  "approval.escalated",
  "acceptance.deemed",
]);

export const CreateWebhookSchema = z.object({
  url: z.string().url().max(2000),
  events: z.array(WebhookEventSchema).min(1),
  enabled: z.boolean().default(true),
});

export const UpdateWebhookSchema = z.object({
  url: z.string().url().max(2000).optional(),
  events: z.array(WebhookEventSchema).min(1).optional(),
  enabled: z.boolean().optional(),
});

export const WebhookViewSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  url: z.string(),
  events: z.array(z.string()),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const WebhookDeliveryViewSchema = z.object({
  id: z.string(),
  subscriptionId: z.string(),
  event: z.string(),
  status: z.enum(["PENDING", "SENT", "FAILED", "DEAD"]),
  attempts: z.number().int().nonnegative(),
  responseStatus: z.number().int().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

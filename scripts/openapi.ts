/* global process, console */
// Generates the ScopeLock OpenAPI spec from the Zod contracts (single source
// of truth for request/response shapes). Run `npm run openapi` after changing
// packages/contracts. `npm run openapi -- --check` fails when the committed
// spec is stale (used by CI).
//
// Usage:
//   npm run openapi [-- --check]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ApiKeyViewSchema,
  CreateApiKeySchema,
  CreateExternalConnectionSchema,
  CreateWebhookSchema,
  ExternalConnectionViewSchema,
  ExternalWorkItemViewSchema,
  NotificationPreferencesViewSchema,
  UpdateExternalConnectionSchema,
  UpdateNotificationPreferencesSchema,
  UpdateOrgSlackSchema,
  UpdateWebhookSchema,
  WebhookDeliveryViewSchema,
  WebhookEventSchema,
  WebhookViewSchema,
} from "@scopelock/contracts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const OUT = join(ROOT, "apps", "api", "src", "openapi.json");

const rootPkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };

// ---------- Minimal Zod v3 -> JSON Schema converter ----------
// Covers exactly the shapes the integration contracts use. Anything else
// throws, so a new contract shape fails loudly instead of mis-rendering.
interface SchemaLike {
  _def: { typeName: string; [key: string]: unknown };
  [key: string]: unknown;
}

function isSchema(value: unknown): value is SchemaLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "_def" in value &&
    typeof (value as { _def: unknown })._def === "object" &&
    (value as { _def: unknown })._def !== null &&
    typeof ((value as { _def: { typeName: unknown } })._def.typeName) === "string"
  );
}

function asSchema(value: unknown, what: string): SchemaLike {
  if (!isSchema(value)) throw new Error(`openapi: ${what} is not a Zod schema`);
  return value;
}

interface CheckLike {
  kind: string;
  value?: unknown;
}

function checksOf(schema: SchemaLike): CheckLike[] {
  const checks = schema._def["checks"];
  if (!Array.isArray(checks)) return [];
  return checks.filter((c): c is CheckLike => typeof c === "object" && c !== null && typeof (c as { kind: unknown }).kind === "string");
}

function convertSchema(schema: SchemaLike): Record<string, unknown> {
  const def = schema._def;
  switch (def.typeName) {
    case "ZodObject": {
      const shape = schema["shape"] as unknown;
      if (typeof shape !== "object" || shape === null) throw new Error("openapi: ZodObject without shape");
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, field] of Object.entries(shape)) {
        const sub = asSchema(field, `field ${key}`);
        properties[key] = convertSchema(sub);
        const inner = sub._def.typeName;
        if (inner !== "ZodOptional" && inner !== "ZodDefault") required.push(key);
      }
      const out: Record<string, unknown> = { type: "object", properties };
      if (required.length > 0) out["required"] = required;
      out["additionalProperties"] = false;
      return out;
    }
    case "ZodString": {
      const out: Record<string, unknown> = { type: "string" };
      for (const check of checksOf(schema)) {
        if (check.kind === "min" && typeof check.value === "number") out["minLength"] = check.value;
        else if (check.kind === "max" && typeof check.value === "number") out["maxLength"] = check.value;
        else if (check.kind === "url") out["format"] = "uri";
        else if (check.kind === "datetime") out["format"] = "date-time";
        else if (check.kind === "email") out["format"] = "email";
        else if (check.kind === "length" && typeof check.value === "number") {
          out["minLength"] = check.value;
          out["maxLength"] = check.value;
        }
      }
      return out;
    }
    case "ZodNumber": {
      const checks = checksOf(schema);
      const out: Record<string, unknown> = { type: checks.some((c) => c.kind === "int") ? "integer" : "number" };
      for (const check of checks) {
        if (check.kind === "min" && typeof check.value === "number") out["minimum"] = check.value;
        else if (check.kind === "max" && typeof check.value === "number") out["maximum"] = check.value;
      }
      return out;
    }
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodEnum": {
      const values = def["values"];
      if (!Array.isArray(values)) throw new Error("openapi: ZodEnum without values");
      return { type: "string", enum: values };
    }
    case "ZodArray": {
      const itemType = asSchema(def["type"], "array items");
      const out: Record<string, unknown> = { type: "array", items: convertSchema(itemType) };
      // Zod v3 stores lengths as { value } objects (or null).
      const len = (key: string): number | null => {
        const entry = def[key] as { value?: unknown } | null;
        return entry && typeof entry.value === "number" ? entry.value : null;
      };
      const min = len("minLength");
      const max = len("maxLength");
      const exact = len("exactLength");
      if (min !== null) out["minItems"] = min;
      if (max !== null) out["maxItems"] = max;
      if (exact !== null) {
        out["minItems"] = exact;
        out["maxItems"] = exact;
      }
      return out;
    }
    case "ZodOptional":
      return convertSchema(asSchema(def["innerType"], "optional inner"));
    case "ZodNullable": {
      const inner = convertSchema(asSchema(def["innerType"], "nullable inner"));
      return { ...inner, nullable: true };
    }
    case "ZodDefault": {
      const inner = convertSchema(asSchema(def["innerType"], "default inner"));
      const getDefault = def["defaultValue"];
      if (typeof getDefault !== "function") throw new Error("openapi: ZodDefault without defaultValue");
      return { ...inner, default: (getDefault as () => unknown)() };
    }
    case "ZodEffects":
      return convertSchema(asSchema(schema["innerType"] ?? def["schema"], "effect inner"));
    default:
      throw new Error(`openapi: unsupported Zod shape ${def.typeName}; extend the converter`);
  }
}

function schemaOf(schema: unknown): Record<string, unknown> {
  return convertSchema(asSchema(schema, "contract"));
}

const ApiKeyView = schemaOf(ApiKeyViewSchema);
const CreateApiKey = schemaOf(CreateApiKeySchema);
const WebhookView = schemaOf(WebhookViewSchema);
const CreateWebhook = schemaOf(CreateWebhookSchema);
const UpdateWebhook = schemaOf(UpdateWebhookSchema);
const WebhookDeliveryView = schemaOf(WebhookDeliveryViewSchema);
const CreateExternalConnection = schemaOf(CreateExternalConnectionSchema);
const UpdateExternalConnection = schemaOf(UpdateExternalConnectionSchema);
const ExternalConnectionView = schemaOf(ExternalConnectionViewSchema);
const ExternalWorkItemView = schemaOf(ExternalWorkItemViewSchema);
const UpdateNotificationPreferences = schemaOf(UpdateNotificationPreferencesSchema);
const NotificationPreferencesView = schemaOf(NotificationPreferencesViewSchema);
const UpdateOrgSlack = schemaOf(UpdateOrgSlackSchema);
const eventEnum = WebhookEventSchema.options as unknown as string[];

function err(description: string): Record<string, unknown> {
  return {
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } },
  };
}

function orgParam(): Record<string, unknown> {
  return { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Organization ID." };
}

function idParam(name: string, description: string): Record<string, unknown> {
  return { name, in: "path", required: true, schema: { type: "string" }, description };
}

const sessionOnly = [{ SessionAuth: [] as string[] }];
const sessionOrKey = [{ SessionAuth: [] as string[] }, { ApiKeyAuth: [] as string[] }];

const spec = {
  openapi: "3.1.0",
  info: {
    title: "ScopeLock API",
    version: rootPkg.version,
    description:
      "System of record for client scope, change requests, approvals and delivery evidence. " +
      "This document covers the integration surface (API keys, outgoing webhooks, external integrations). " +
      "Shapes are generated from the Zod contracts in packages/contracts; regenerate with `npm run openapi`.",
  },
  servers: [{ url: "/api/v1", description: "Same origin as the API deployment." }],
  tags: [
    { name: "API keys", description: "Hashed, scoped, rotatable machine credentials." },
    { name: "Webhooks", description: "Outgoing event subscriptions with HMAC-signed deliveries." },
    { name: "External integrations", description: "Provider webhook intake (GitHub) and observed work identifiers." },
    { name: "Notification channels", description: "Per-user channel preferences and the org Slack connection." },
  ],
  security: sessionOrKey,
  paths: {
    "/organizations/{id}/api-keys": {
      get: {
        tags: ["API keys"],
        summary: "List API keys",
        security: sessionOnly,
        parameters: [orgParam()],
        responses: {
          "200": {
            description: "Keys (never includes secrets).",
            content: {
              "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/ApiKeyView" } } },
            },
          },
          "400": err("Bad request."),
          "401": err("Authentication required."),
          "403": err("Requires org.manage."),
        },
      },
      post: {
        tags: ["API keys"],
        summary: "Create an API key",
        description: "The secret is shown once in the response and is stored hashed. Prefer short-lived keys.",
        security: sessionOnly,
        parameters: [orgParam()],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CreateApiKey" } } },
        },
        responses: {
          "201": {
            description: "Created key and one-time secret.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ApiKeyCreated" } } },
          },
          "400": err("Validation failed."),
          "401": err("Authentication required."),
          "403": err("Requires org.manage."),
          "409": err("Key quota or name conflict."),
        },
      },
    },
    "/organizations/{id}/api-keys/{keyId}/rotate": {
      post: {
        tags: ["API keys"],
        summary: "Rotate an API key",
        description: "Issues a new secret, revokes the old one. The new secret is shown once.",
        security: sessionOnly,
        parameters: [orgParam(), idParam("keyId", "API key ID.")],
        responses: {
          "201": {
            description: "Rotated key and one-time secret.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ApiKeyCreated" } } },
          },
          "401": err("Authentication required."),
          "403": err("Requires org.manage."),
          "404": err("Key not found."),
        },
      },
    },
    "/organizations/{id}/api-keys/{keyId}": {
      delete: {
        tags: ["API keys"],
        summary: "Revoke an API key",
        security: sessionOnly,
        parameters: [orgParam(), idParam("keyId", "API key ID.")],
        responses: {
          "200": {
            description: "Revoked key.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ApiKeyView" } } },
          },
          "401": err("Authentication required."),
          "403": err("Requires org.manage."),
          "404": err("Key not found."),
        },
      },
    },
    "/organizations/{id}/webhooks": {
      get: {
        tags: ["Webhooks"],
        summary: "List webhook subscriptions",
        parameters: [orgParam()],
        responses: {
          "200": {
            description: "Subscriptions (never includes signing secrets).",
            content: {
              "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/WebhookView" } } },
            },
          },
          "401": err("Authentication required."),
          "403": err("Requires org.manage (or a key with that scope)."),
        },
      },
      post: {
        tags: ["Webhooks"],
        summary: "Create a webhook subscription",
        description:
          "The signing secret is shown once. Targets are screened against SSRF " +
          "(https-only in production; private/link-local/loopback blocked, including after DNS).",
        parameters: [orgParam()],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CreateWebhook" } } },
        },
        responses: {
          "201": {
            description: "Created subscription and one-time signing secret.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/WebhookCreated" } } },
          },
          "400": err("Validation failed or target blocked."),
          "401": err("Authentication required."),
          "403": err("Requires org.manage (or a key with that scope)."),
        },
      },
    },
    "/organizations/{id}/webhooks/{hookId}": {
      patch: {
        tags: ["Webhooks"],
        summary: "Update a webhook subscription",
        parameters: [orgParam(), idParam("hookId", "Webhook subscription ID.")],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateWebhook" } } },
        },
        responses: {
          "200": {
            description: "Updated subscription.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/WebhookView" } } },
          },
          "400": err("Validation failed or target blocked."),
          "401": err("Authentication required."),
          "403": err("Requires org.manage (or a key with that scope)."),
          "404": err("Subscription not found."),
        },
      },
      delete: {
        tags: ["Webhooks"],
        summary: "Delete a webhook subscription",
        parameters: [orgParam(), idParam("hookId", "Webhook subscription ID.")],
        responses: {
          "204": { description: "Deleted." },
          "401": err("Authentication required."),
          "403": err("Requires org.manage (or a key with that scope)."),
          "404": err("Subscription not found."),
        },
      },
    },
    "/organizations/{id}/webhooks/{hookId}/rotate-secret": {
      post: {
        tags: ["Webhooks"],
        summary: "Rotate a webhook signing secret",
        description: "Issues a new secret, shown once. In-flight deliveries keep the old signature.",
        parameters: [orgParam(), idParam("hookId", "Webhook subscription ID.")],
        responses: {
          "201": {
            description: "Subscription and one-time signing secret.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/WebhookCreated" } } },
          },
          "401": err("Authentication required."),
          "403": err("Requires org.manage (or a key with that scope)."),
          "404": err("Subscription not found."),
        },
      },
    },
    "/organizations/{id}/webhooks/{hookId}/deliveries": {
      get: {
        tags: ["Webhooks"],
        summary: "List webhook deliveries",
        parameters: [
          orgParam(),
          idParam("hookId", "Webhook subscription ID."),
          { name: "cursor", in: "query", required: false, schema: { type: "string" } },
          { name: "limit", in: "query", required: false, schema: { type: "integer", default: 50 } },
        ],
        responses: {
          "200": {
            description: "Cursor-paginated delivery log.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/WebhookDeliveryPage" } } },
          },
          "401": err("Authentication required."),
          "403": err("Requires org.manage (or a key with that scope)."),
          "404": err("Subscription not found."),
        },
      },
    },
    "/organizations/{id}/webhooks/{hookId}/deliveries/{deliveryId}/replay": {
      post: {
        tags: ["Webhooks"],
        summary: "Replay a webhook delivery",
        description: "Re-queues the stored request body through the outbox. Idempotent per replay.",
        parameters: [orgParam(), idParam("hookId", "Webhook subscription ID."), idParam("deliveryId", "Delivery ID.")],
        responses: {
          "202": {
            description: "Replay queued.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/WebhookDeliveryView" } } },
          },
          "401": err("Authentication required."),
          "403": err("Requires org.manage (or a key with that scope)."),
          "404": err("Subscription or delivery not found."),
        },
      },
    },
    "/projects/{id}/external-connections": {
      get: {
        tags: ["External integrations"],
        summary: "List provider connections",
        parameters: [idParam("id", "Project ID.")],
        responses: {
          "200": {
            description: "Connections (never includes secrets).",
            content: {
              "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/ExternalConnectionView" } } },
            },
          },
          "401": err("Authentication required."),
          "403": err("Requires project.view."),
          "404": err("Project not found."),
        },
      },
      post: {
        tags: ["External integrations"],
        summary: "Connect a provider",
        description:
          "Creates one connection per provider with a once-only webhook secret. " +
          "Requires the project's external-integrations opt-in.",
        parameters: [idParam("id", "Project ID.")],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/CreateExternalConnection" } } },
        },
        responses: {
          "201": {
            description: "Connection, one-time secret, and webhook URL.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ExternalConnectionCreated" } } },
          },
          "400": err("Validation failed."),
          "401": err("Authentication required."),
          "403": err("Requires external.manage."),
          "404": err("Project not found."),
          "409": err("A connection for this provider already exists."),
          "422": err("External integrations are not enabled for this project."),
        },
      },
    },
    "/projects/{id}/external-connections/{connectionId}": {
      patch: {
        tags: ["External integrations"],
        summary: "Enable or disable a connection",
        parameters: [idParam("id", "Project ID."), idParam("connectionId", "Connection ID.")],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateExternalConnection" } } },
        },
        responses: {
          "200": {
            description: "Updated connection.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ExternalConnectionView" } } },
          },
          "401": err("Authentication required."),
          "403": err("Requires external.manage."),
          "404": err("Project or connection not found."),
        },
      },
      delete: {
        tags: ["External integrations"],
        summary: "Delete a connection",
        description: "Observed work and links stay as evidence; only intake is removed.",
        parameters: [idParam("id", "Project ID."), idParam("connectionId", "Connection ID.")],
        responses: {
          "200": {
            description: "Deleted.",
            content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } },
          },
          "401": err("Authentication required."),
          "403": err("Requires external.manage."),
          "404": err("Project or connection not found."),
        },
      },
    },
    "/projects/{id}/external-connections/{connectionId}/rotate-secret": {
      post: {
        tags: ["External integrations"],
        summary: "Rotate a connection secret",
        description: "Issues a new webhook secret, shown once. Update the provider webhook before deliveries resume.",
        parameters: [idParam("id", "Project ID."), idParam("connectionId", "Connection ID.")],
        responses: {
          "201": {
            description: "Connection and one-time secret.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ExternalConnectionRotated" } } },
          },
          "401": err("Authentication required."),
          "403": err("Requires external.manage."),
          "404": err("Project or connection not found."),
        },
      },
    },
    "/projects/{id}/external-work": {
      get: {
        tags: ["External integrations"],
        summary: "List observed external work",
        description: "Minimal identifiers (external id, kind, refs, merged state). Never code or full payloads.",
        parameters: [
          idParam("id", "Project ID."),
          { name: "cursor", in: "query", required: false, schema: { type: "string" } },
          { name: "limit", in: "query", required: false, schema: { type: "integer", default: 25 } },
        ],
        responses: {
          "200": {
            description: "Cursor-paginated work items.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ExternalWorkPage" } } },
          },
          "401": err("Authentication required."),
          "403": err("Requires project.view."),
          "404": err("Project not found."),
        },
      },
    },
    "/auth/me/preferences": {
      get: {
        tags: ["Notification channels"],
        summary: "Get my notification preferences",
        security: sessionOnly,
        responses: {
          "200": {
            description: "Phone number and per-channel toggles.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/NotificationPreferencesView" } } },
          },
          "401": err("Authentication required."),
        },
      },
      patch: {
        tags: ["Notification channels"],
        summary: "Update my notification preferences",
        description: "Phone numbers must be E.164; null clears the phone.",
        security: sessionOnly,
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateNotificationPreferences" } } },
        },
        responses: {
          "200": {
            description: "Updated preferences.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/NotificationPreferencesView" } } },
          },
          "401": err("Authentication required."),
          "422": err("Phone number is not E.164."),
        },
      },
    },
    "/organizations/{id}/slack": {
      patch: {
        tags: ["Notification channels"],
        summary: "Connect or disconnect org Slack",
        description: "SSRF-screened incoming-webhook URL, sealed at rest; null disconnects. The URL is never returned.",
        security: sessionOnly,
        parameters: [orgParam()],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateOrgSlack" } } },
        },
        responses: {
          "200": {
            description: "Updated org (with slackConfigured flag).",
            content: { "application/json": { schema: { type: "object" } } },
          },
          "400": err("Validation failed or target blocked."),
          "401": err("Authentication required."),
          "403": err("Requires org.manage."),
          "404": err("Organization not found."),
        },
      },
    },
  },
  webhooks: Object.fromEntries(
    eventEnum.map((event) => [
      event,
      {
        post: {
          summary: `Outgoing ${event} event`,
          description:
            "Delivered through the outbox with exponential backoff. Verify `X-ScopeLock-Signature` " +
            "(`v1=<hex HMAC-SHA256(secret, \"<timestamp>.<raw body>\")>`) with a constant-time compare " +
            "and reject timestamps older than 5 minutes.",
          parameters: [
            { name: "X-ScopeLock-Event", in: "header", required: true, schema: { type: "string" } },
            { name: "X-ScopeLock-Timestamp", in: "header", required: true, schema: { type: "string" } },
            { name: "X-ScopeLock-Signature", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/WebhookPayload" } } },
          },
          responses: { "200": { description: "Acknowledged. Any 2xx stops retries." } },
        },
      },
    ]),
  ),
  components: {
    securitySchemes: {
      SessionAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "User session token from POST /api/v1/auth/login.",
      },
      ApiKeyAuth: {
        type: "http",
        scheme: "bearer",
        description:
          "Machine key (`sk_...`) created via the API-keys endpoints. Calls are authorized through the same " +
          "policy layer as sessions, limited to the key's scopes, and rate-limited per key.",
      },
    },
    schemas: {
      UpdateNotificationPreferences,
      NotificationPreferencesView,
      UpdateOrgSlack,
      ExternalConnectionView,
      CreateExternalConnection,
      UpdateExternalConnection,
      ExternalConnectionCreated: {
        type: "object",
        required: ["connection", "secret", "webhookUrl"],
        properties: {
          connection: { $ref: "#/components/schemas/ExternalConnectionView" },
          secret: { type: "string", description: "One-time webhook secret. It is never returned again." },
          webhookUrl: { type: "string", format: "uri", description: "Configure this URL in the provider webhook settings." },
        },
      },
      ExternalConnectionRotated: {
        type: "object",
        required: ["connection", "secret"],
        properties: {
          connection: { $ref: "#/components/schemas/ExternalConnectionView" },
          secret: { type: "string", description: "One-time webhook secret. It is never returned again." },
        },
      },
      ExternalWorkItemView,
      ExternalWorkPage: {
        type: "object",
        required: ["data", "pagination"],
        properties: {
          data: { type: "array", items: { $ref: "#/components/schemas/ExternalWorkItemView" } },
          pagination: {
            type: "object",
            required: ["nextCursor"],
            properties: { nextCursor: { type: "string", nullable: true } },
          },
        },
      },
      ApiKeyView,
      CreateApiKey,
      ApiKeyCreated: {
        type: "object",
        required: ["key", "secret"],
        properties: {
          key: { $ref: "#/components/schemas/ApiKeyView" },
          secret: { type: "string", description: "One-time secret. It is never returned again." },
        },
      },
      WebhookView,
      CreateWebhook,
      UpdateWebhook,
      WebhookCreated: {
        type: "object",
        required: ["webhook", "secret"],
        properties: {
          webhook: { $ref: "#/components/schemas/WebhookView" },
          secret: { type: "string", description: "One-time HMAC signing secret." },
        },
      },
      WebhookDeliveryView,
      WebhookDeliveryPage: {
        type: "object",
        required: ["items", "nextCursor"],
        properties: {
          items: { type: "array", items: { $ref: "#/components/schemas/WebhookDeliveryView" } },
          nextCursor: { type: "string", nullable: true },
        },
      },
      WebhookPayload: {
        type: "object",
        required: ["id", "event", "occurredAt", "data"],
        properties: {
          id: { type: "string", description: "Delivery body ID (dedupe key)." },
          event: { type: "string", enum: eventEnum },
          occurredAt: { type: "string", format: "date-time" },
          data: { type: "object", description: "Event data: IDs and snapshots, no secrets.", additionalProperties: true },
        },
      },
      ApiError: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              correlationId: { type: "string" },
              details: { type: "object", additionalProperties: true },
            },
          },
        },
      },
    },
  },
};

const rendered = `${JSON.stringify(spec, null, 2)}\n`;
if (process.argv.includes("--check")) {
  const current = readFileSync(OUT, "utf8");
  if (current !== rendered) {
    console.error("openapi.json is stale: run `npm run openapi` and commit the result.");
    process.exit(1);
  }
  console.log("openapi.json is fresh.");
} else {
  writeFileSync(OUT, rendered);
  console.log(`wrote ${OUT}`);
}

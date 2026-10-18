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
  CreateWebhookSchema,
  UpdateWebhookSchema,
  WebhookDeliveryViewSchema,
  WebhookEventSchema,
  WebhookViewSchema,
} from "@scopelock/contracts";
import { zodToJsonSchema } from "zod-to-json-schema";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const OUT = join(ROOT, "apps", "api", "src", "openapi.json");

const rootPkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string };

function schemaOf(name: string, schema: Parameters<typeof zodToJsonSchema>[0]): Record<string, unknown> {
  const out = zodToJsonSchema(schema, { name, target: "openApi3" });
  const defs = (out as { definitions?: Record<string, unknown> }).definitions;
  if (defs && defs[name]) return defs[name] as Record<string, unknown>;
  const { $schema: _schema, ...rest } = out as Record<string, unknown>;
  void _schema;
  return rest;
}

const ApiKeyView = schemaOf("ApiKeyView", ApiKeyViewSchema);
const CreateApiKey = schemaOf("CreateApiKey", CreateApiKeySchema);
const WebhookView = schemaOf("WebhookView", WebhookViewSchema);
const CreateWebhook = schemaOf("CreateWebhook", CreateWebhookSchema);
const UpdateWebhook = schemaOf("UpdateWebhook", UpdateWebhookSchema);
const WebhookDeliveryView = schemaOf("WebhookDeliveryView", WebhookDeliveryViewSchema);
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
      "This document covers the integration surface (API keys, outgoing webhooks). " +
      "Shapes are generated from the Zod contracts in packages/contracts; regenerate with `npm run openapi`.",
  },
  servers: [{ url: "/api/v1", description: "Same origin as the API deployment." }],
  tags: [
    { name: "API keys", description: "Hashed, scoped, rotatable machine credentials." },
    { name: "Webhooks", description: "Outgoing event subscriptions with HMAC-signed deliveries." },
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

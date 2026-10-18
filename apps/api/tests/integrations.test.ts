import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { ApiKeyScopeSchema, WebhookEventSchema } from "@scopelock/contracts";
import { ACTIONS, WEBHOOK_EVENTS, verifyWebhookSignature } from "@scopelock/domain";
import { checkApiKeyLimit, resetRateLimits } from "../src/http/rate-limit.js";
import { drainOnce } from "../src/lib/worker.js";
import { agencyFixture, createClient, createProject, createTestApp, register, type Agent } from "./helpers.js";

interface Received {
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

let servers: Server[] = [];
afterEach(async () => {
  resetRateLimits();
  for (const server of servers) await new Promise<void>((resolve) => server.close(() => resolve()));
  servers = [];
});

async function startReceiver(handler: (received: Received[]) => { status: number }): Promise<{ url: string; received: Received[] }> {
  const received: Received[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf8");
    });
    req.on("end", () => {
      received.push({ headers: req.headers as Record<string, string | string[] | undefined>, body });
      res.writeHead(handler(received).status, { "content-type": "text/plain" }).end("ok");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  servers.push(server);
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}/hook`, received };
}

async function sendableChangeId(agent: Agent, projectId: string): Promise<string> {
  const created = await agent.post(`/api/v1/projects/${projectId}/change-requests`).send({
    title: "Webhook work",
    description: "Webhook work description",
    source: "AGENCY",
  });
  expect(created.status).toBe(201);
  const id = created.body.id as string;
  let v = created.body.version as number;
  for (const status of ["SUBMITTED", "TRIAGING", "ESTIMATING"]) {
    const res = await agent.patch(`/api/v1/change-requests/${id}`).send({
      expectedVersion: v,
      status,
      ...(status === "TRIAGING" ? { classification: "POTENTIAL_CHANGE", classificationRationale: "New work" } : {}),
    });
    expect(res.status).toBe(200);
    v = res.body.version as number;
  }
  const impact = await agent.post(`/api/v1/change-requests/${id}/impact`).send({
    effortDays: 2,
    priceMinor: 50000,
    timelineDays: 3,
    confidence: "HIGH",
  });
  expect(impact.status).toBe(201);
  return id;
}

describe("contract parity", () => {
  it("keeps key scopes and webhook events in sync with the domain", () => {
    expect(new Set(ApiKeyScopeSchema.options)).toEqual(new Set([...ACTIONS, "*"]));
    expect([...WebhookEventSchema.options].sort()).toEqual([...WEBHOOK_EVENTS].sort());
  });
});

describe("API keys", () => {
  it("creates keys with a once-only secret and authenticates within scopes", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    const created = await fx.owner.agent.post(`/api/v1/organizations/${fx.organizationId}/api-keys`).send({
      name: "ci",
      scopes: ["project.view", "activity.view"],
    });
    expect(created.status).toBe(201);
    const secret = (created.body as { secret: string }).secret;
    expect(secret).toMatch(/^sk_[A-Za-z0-9_-]{32}$/);
    const keyId = ((created.body as { key: { id: string } }).key).id;

    // The list never exposes secrets or hashes.
    const list = await fx.owner.agent.get(`/api/v1/organizations/${fx.organizationId}/api-keys`);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain(secret);
    expect(JSON.stringify(list.body)).not.toContain("keyHash");
    expect((list.body as Array<{ prefix: string }>)[0]?.prefix).toBe(secret.slice(0, 11));

    // In-scope read works; out-of-scope mutation is rejected by scope, not role.
    const keyed = request(app);
    const read = await keyed.get(`/api/v1/projects/${fx.projectId}`).set("Authorization", `Bearer ${secret}`);
    expect(read.status).toBe(200);
    const write = await keyed.patch(`/api/v1/projects/${fx.projectId}`).set("Authorization", `Bearer ${secret}`).send({ name: "Nope" });
    expect(write.status).toBe(403);
    expect((write.body as { error: { message: string } }).error.message).toMatch(/not scoped/);
    expect((await store.findApiKeyById(keyId))?.lastUsedAt).not.toBe(null);
  });

  it("rejects unknown, revoked, and expired keys", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    const created = await fx.owner.agent.post(`/api/v1/organizations/${fx.organizationId}/api-keys`).send({ name: "temp", scopes: ["*"] });
    const secret = (created.body as { secret: string }).secret;
    const keyId = ((created.body as { key: { id: string } }).key).id;

    const unknown = await request(app).get(`/api/v1/projects/${fx.projectId}`).set("Authorization", "Bearer sk_doesnotexist00000000000000000");
    expect(unknown.status).toBe(401);

    await store.updateApiKey(keyId, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    const expired = await request(app).get(`/api/v1/projects/${fx.projectId}`).set("Authorization", `Bearer ${secret}`);
    expect(expired.status).toBe(401);

    await store.updateApiKey(keyId, { expiresAt: null, revokedAt: new Date().toISOString() });
    const revoked = await request(app).get(`/api/v1/projects/${fx.projectId}`).set("Authorization", `Bearer ${secret}`);
    expect(revoked.status).toBe(401);
  });

  it("rotates keys and revokes via the API", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const created = await fx.owner.agent.post(`/api/v1/organizations/${fx.organizationId}/api-keys`).send({ name: "deploy", scopes: ["project.view"] });
    const oldSecret = (created.body as { secret: string }).secret;
    const keyId = ((created.body as { key: { id: string } }).key).id;

    const rotated = await fx.owner.agent.post(`/api/v1/organizations/${fx.organizationId}/api-keys/${keyId}/rotate`).send();
    expect(rotated.status).toBe(201);
    const newSecret = (rotated.body as { secret: string }).secret;
    expect(newSecret).not.toBe(oldSecret);
    expect((rotated.body as { key: { scopes: string[] } }).key.scopes).toEqual(["project.view"]);

    const oldAuth = await request(app).get(`/api/v1/projects/${fx.projectId}`).set("Authorization", `Bearer ${oldSecret}`);
    expect(oldAuth.status).toBe(401);
    const newAuth = await request(app).get(`/api/v1/projects/${fx.projectId}`).set("Authorization", `Bearer ${newSecret}`);
    expect(newAuth.status).toBe(200);
    const newKeyId = ((rotated.body as { key: { id: string } }).key).id;

    const revoked = await fx.owner.agent.delete(`/api/v1/organizations/${fx.organizationId}/api-keys/${newKeyId}`).send();
    expect(revoked.status).toBe(200);
    expect((revoked.body as { revokedAt: string | null }).revokedAt).not.toBe(null);
    const after = await request(app).get(`/api/v1/projects/${fx.projectId}`).set("Authorization", `Bearer ${newSecret}`);
    expect(after.status).toBe(401);
  });

  it("rate-limits keys per key id", async () => {
    expect(checkApiKeyLimit("key_test", { max: 2, windowMs: 60_000 }).ok).toBe(true);
    expect(checkApiKeyLimit("key_test", { max: 2, windowMs: 60_000 }).ok).toBe(true);
    const verdict = checkApiKeyLimit("key_test", { max: 2, windowMs: 60_000 });
    expect(verdict.ok).toBe(false);
    expect(verdict.retryAfterSec).toBeGreaterThan(0);
    expect(checkApiKeyLimit("key_other", { max: 2, windowMs: 60_000 }).ok).toBe(true);
  });

  it("enforces the per-key quota on real requests", async () => {
    const { app, ctx } = createTestApp();
    ctx.env.RATE_LIMIT_DISABLED = false;
    ctx.env.API_KEY_RATE_LIMIT_PER_MIN = 10;
    const fx = await agencyFixture(app);
    const created = await fx.owner.agent.post(`/api/v1/organizations/${fx.organizationId}/api-keys`).send({ name: "limited", scopes: ["*"] });
    const secret = (created.body as { secret: string }).secret;
    for (let i = 0; i < 10; i++) {
      const res = await request(app).get(`/api/v1/projects/${fx.projectId}`).set("Authorization", `Bearer ${secret}`);
      expect(res.status).toBe(200);
    }
    const limited = await request(app).get(`/api/v1/projects/${fx.projectId}`).set("Authorization", `Bearer ${secret}`);
    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
  });

  it("hides other orgs' keys and webhooks (IDOR)", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const stranger = await register(app, { organizationName: "Stranger" });
    const strangerClient = await createClient(app, stranger.agent, stranger.organization.id);
    const strangerProject = await createProject(app, stranger.agent, { organizationId: stranger.organization.id, clientId: strangerClient.id });
    // Sessions from another org see nothing, without existence disclosure.
    expect((await stranger.agent.get(`/api/v1/organizations/${fx.organizationId}/api-keys`)).status).toBe(404);
    expect((await stranger.agent.get(`/api/v1/organizations/${fx.organizationId}/webhooks`)).status).toBe(404);
    // A key issued by one org cannot read another org's resources.
    const created = await fx.owner.agent.post(`/api/v1/organizations/${fx.organizationId}/api-keys`).send({ name: "scoped", scopes: ["*"] });
    const secret = (created.body as { secret: string }).secret;
    const cross = await request(app).get(`/api/v1/projects/${strangerProject.id}`).set("Authorization", `Bearer ${secret}`);
    expect([401, 403, 404]).toContain(cross.status);
  });
});

describe("OpenAPI spec", () => {
  it("serves the generated spec with the integration surface", async () => {
    const { app } = await createTestApp();
    const res = await request(app).get("/api/openapi.json");
    expect(res.status).toBe(200);
    const paths = Object.keys(res.body.paths as Record<string, unknown>);
    expect(paths).toContain("/organizations/{id}/api-keys");
    expect(paths).toContain("/organizations/{id}/webhooks/{hookId}/deliveries/{deliveryId}/replay");
    expect(paths).toContain("/projects/{id}/external-connections");
    expect(paths).toContain("/projects/{id}/external-work");
    expect(Object.keys(res.body.webhooks as Record<string, unknown>)).toContain("approval.decided");
    expect(Object.keys(res.body.components.schemas as Record<string, unknown>)).toContain("ApiKeyView");
    expect(Object.keys(res.body.components.schemas as Record<string, unknown>)).toContain("ExternalWorkItemView");
  });
});

describe("outgoing webhooks", () => {
  it("manages subscriptions with SSRF screening and once-only secrets", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const created = await fx.owner.agent.post(`/api/v1/organizations/${fx.organizationId}/webhooks`).send({
      url: "http://127.0.0.1:9/hook",
      events: ["approval.sent", "approval.decided"],
    });
    expect(created.status).toBe(201);
    const secret = (created.body as { secret: string }).secret;
    expect(secret).toMatch(/^whsec_/);
    const hookId = ((created.body as { webhook: { id: string } }).webhook).id;

    const list = await fx.owner.agent.get(`/api/v1/organizations/${fx.organizationId}/webhooks`);
    expect(JSON.stringify(list.body)).not.toContain(secret);
    expect(JSON.stringify(list.body)).not.toContain("secretSealed");

    const rotated = await fx.owner.agent.post(`/api/v1/organizations/${fx.organizationId}/webhooks/${hookId}/rotate-secret`).send();
    expect(rotated.status).toBe(201);
    expect((rotated.body as { secret: string }).secret).not.toBe(secret);

    const updated = await fx.owner.agent.patch(`/api/v1/organizations/${fx.organizationId}/webhooks/${hookId}`).send({ enabled: false });
    expect(updated.status).toBe(200);
    expect((updated.body as { enabled: boolean }).enabled).toBe(false);

    const blocked = await fx.owner.agent.post(`/api/v1/organizations/${fx.organizationId}/webhooks`).send({
      url: "https://10.0.0.5/hook",
      events: ["approval.sent"],
    });
    expect(blocked.status).toBe(422);
    const creds = await fx.owner.agent.post(`/api/v1/organizations/${fx.organizationId}/webhooks`).send({
      url: "https://user:pass@127.0.0.1:9/hook",
      events: ["approval.sent"],
    });
    expect(creds.status).toBe(422);

    const client = await fx.client.agent.post(`/api/v1/organizations/${fx.organizationId}/webhooks`).send({
      url: "http://127.0.0.1:9/hook",
      events: ["approval.sent"],
    });
    expect(client.status).toBe(403);

    const deleted = await fx.owner.agent.delete(`/api/v1/organizations/${fx.organizationId}/webhooks/${hookId}`).send();
    expect(deleted.status).toBe(204);
  });

  it("delivers signed events and logs the delivery", async () => {
    const { app, ctx } = createTestApp();
    const fx = await agencyFixture(app);
    const { url, received } = await startReceiver(() => ({ status: 200 }));
    const created = await fx.owner.agent.post(`/api/v1/organizations/${fx.organizationId}/webhooks`).send({
      url,
      events: ["approval.sent", "approval.decided"],
    });
    expect(created.status).toBe(201);
    const secret = (created.body as { secret: string }).secret;
    const hookId = ((created.body as { webhook: { id: string } }).webhook).id;

    const changeId = await sendableChangeId(fx.owner.agent, fx.projectId);
    const sent = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });
    expect(sent.status).toBe(201);
    await drainOnce({ store: ctx.store, env: ctx.env, email: ctx.email, realtime: ctx.realtime });

    expect(received).toHaveLength(1);
    const first = received[0] as Received;
    expect(first.headers["x-scopelock-event"]).toBe("approval.sent");
    const timestamp = first.headers["x-scopelock-timestamp"] as string;
    expect(timestamp).toMatch(/^\d{10}$/);
    expect(verifyWebhookSignature(secret, timestamp, first.body, first.headers["x-scopelock-signature"] as string)).toBe(true);
    const parsed = JSON.parse(first.body) as { id: string; event: string; occurredAt: string; data: { approvalId: string; kind: string } };
    expect(parsed.event).toBe("approval.sent");
    expect(parsed.data.approvalId).toBe((sent.body.approval as { id: string }).id);
    expect(parsed.data.kind).toBe("CHANGE");

    const deliveries = await fx.owner.agent.get(`/api/v1/organizations/${fx.organizationId}/webhooks/${hookId}/deliveries`);
    expect(deliveries.status).toBe(200);
    const items = (deliveries.body as { items: Array<{ event: string; status: string; attempts: number; responseStatus: number }> }).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ event: "approval.sent", status: "SENT", attempts: 1, responseStatus: 200 });
  });

  it("retries failures with backoff and replays on demand", async () => {
    const { app, ctx, store } = createTestApp();
    const fx = await agencyFixture(app);
    let fail = true;
    const { url, received } = await startReceiver(() => ({ status: fail ? 500 : 200 }));
    const created = await fx.owner.agent.post(`/api/v1/organizations/${fx.organizationId}/webhooks`).send({ url, events: ["approval.sent"] });
    expect(created.status).toBe(201);
    const hookId = ((created.body as { webhook: { id: string } }).webhook).id;

    const changeId = await sendableChangeId(fx.owner.agent, fx.projectId);
    await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });
    await drainOnce({ store: ctx.store, env: ctx.env, email: ctx.email, realtime: ctx.realtime });
    expect(received).toHaveLength(1);

    const failed = await fx.owner.agent.get(`/api/v1/organizations/${fx.organizationId}/webhooks/${hookId}/deliveries`);
    const row = ((failed.body as { items: Array<{ id: string; status: string; attempts: number; responseStatus: number }> }).items)[0] as { id: string; status: string; attempts: number; responseStatus: number };
    expect(row).toMatchObject({ status: "FAILED", attempts: 1, responseStatus: 500 });

    // A drain before the backoff elapses does not redeliver.
    await drainOnce({ store: ctx.store, env: ctx.env, email: ctx.email, realtime: ctx.realtime });
    expect(received).toHaveLength(1);

    // Once the receiver recovers and the backoff elapses, delivery succeeds.
    fail = false;
    const delivery = await store.findWebhookDeliveryById(row.id);
    if (!delivery?.outboxEventId) throw new Error("expected a linked outbox row");
    await store.updateOutbox(delivery.outboxEventId, { nextRunAt: new Date(Date.now() - 1000).toISOString() });
    await drainOnce({ store: ctx.store, env: ctx.env, email: ctx.email, realtime: ctx.realtime });
    expect(received).toHaveLength(2);

    // Manual replay reuses the event id so receivers can dedupe.
    const replay = await fx.owner.agent.post(`/api/v1/organizations/${fx.organizationId}/webhooks/${hookId}/deliveries/${row.id}/replay`).send();
    expect(replay.status).toBe(202);
    await drainOnce({ store: ctx.store, env: ctx.env, email: ctx.email, realtime: ctx.realtime });
    expect(received).toHaveLength(3);
    const ids = received.map((r) => (JSON.parse(r.body) as { id: string }).id);
    expect(new Set(ids).size).toBe(1);
    const after = await fx.owner.agent.get(`/api/v1/organizations/${fx.organizationId}/webhooks/${hookId}/deliveries`);
    expect((((after.body as { items: Array<{ status: string }> }).items)[0] as { status: string }).status).toBe("SENT");
  });

  it("emits only subscribed, enabled events", async () => {
    const { app, ctx } = createTestApp();
    const fx = await agencyFixture(app);
    const { url, received } = await startReceiver(() => ({ status: 200 }));
    const created = await fx.owner.agent.post(`/api/v1/organizations/${fx.organizationId}/webhooks`).send({ url, events: ["approval.decided"] });
    const hookId = ((created.body as { webhook: { id: string } }).webhook).id;

    const changeId = await sendableChangeId(fx.owner.agent, fx.projectId);
    const sent = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });
    await drainOnce({ store: ctx.store, env: ctx.env, email: ctx.email, realtime: ctx.realtime });
    expect(received).toHaveLength(0);

    const token = ((sent.body as { reviewUrls: string[] }).reviewUrls[0] as string).split("/review/")[1] as string;
    const decide = await request(app).post(`/api/v1/approval-requests/${token}/decisions`).send({ decision: "APPROVED", confirm: true });
    expect(decide.status).toBe(201);
    await drainOnce({ store: ctx.store, env: ctx.env, email: ctx.email, realtime: ctx.realtime });
    expect(received).toHaveLength(1);
    expect((received[0] as Received).headers["x-scopelock-event"]).toBe("approval.decided");

    await fx.owner.agent.patch(`/api/v1/organizations/${fx.organizationId}/webhooks/${hookId}`).send({ enabled: false });
    const changeId2 = await sendableChangeId(fx.owner.agent, fx.projectId);
    await fx.owner.agent.post(`/api/v1/change-requests/${changeId2}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });
    await drainOnce({ store: ctx.store, env: ctx.env, email: ctx.email, realtime: ctx.realtime });
    expect(received).toHaveLength(1);
  });
});

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { notify, notifyChannels } from "../src/lib/notify.js";
import { createSlackDriver } from "../src/lib/slack.js";
import { createSmsDriver, createWhatsappDriver } from "../src/lib/sms.js";
import { drainOnce } from "../src/lib/worker.js";
import type { OutboxEvent } from "../src/store/index.js";
import type { MemoryStore } from "../src/store/memory.js";
import { agencyFixture, createTestApp } from "./helpers.js";

function outboxOf(store: MemoryStore): OutboxEvent[] {
  return (store.dump().outbox ?? []) as unknown as OutboxEvent[];
}

function ofType(store: MemoryStore, type: OutboxEvent["type"], notificationType?: string): OutboxEvent[] {
  return outboxOf(store).filter(
    (r) => r.type === type && (notificationType === undefined || (r.payload as { notificationType?: string }).notificationType === notificationType),
  );
}

let servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise<void>((resolve) => s.close(() => resolve()))));
  servers = [];
});

function localReceiver(status: number, seen: Array<{ url: string; body: string }>): Promise<string> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk: Buffer) => {
        raw += chunk.toString("utf8");
      });
      req.on("end", () => {
        seen.push({ url: req.url ?? "", body: raw });
        res.statusCode = status;
        res.end("{}");
      });
    });
    server.listen(0, "127.0.0.1", () => {
      servers.push(server);
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`);
    });
  });
}

describe("notification preferences", () => {
  it("defaults to all channels on with no phone, then updates", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const initial = await fx.owner.agent.get("/api/v1/auth/me/preferences");
    expect(initial.status).toBe(200);
    expect(initial.body).toEqual({ userId: fx.owner.user.id, phoneE164: null, notifyEmail: true, notifySms: true, notifyWhatsapp: true, locale: "en" });

    const updated = await fx.owner.agent.patch("/api/v1/auth/me/preferences").send({
      phoneE164: "+880 1712-345678",
      notifySms: false,
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toEqual({ userId: fx.owner.user.id, phoneE164: "+8801712345678", notifyEmail: true, notifySms: false, notifyWhatsapp: true, locale: "en" });

    const cleared = await fx.owner.agent.patch("/api/v1/auth/me/preferences").send({ phoneE164: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.phoneE164).toBeNull();
  });

  it("rejects non-E.164 phones and unauthenticated access", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    for (const phone of ["01712345678", "+12", "not-a-phone", "+88017ABC5678"]) {
      const res = await fx.owner.agent.patch("/api/v1/auth/me/preferences").send({ phoneE164: phone });
      expect(res.status).toBe(422);
    }
    const anon = createTestApp();
    expect((await request(anon.app).get("/api/v1/auth/me/preferences")).status).toBe(401);
    expect((await request(anon.app).patch("/api/v1/auth/me/preferences").send({ notifyEmail: false })).status).toBe(401);
  });

  it("keeps users from touching each other's preferences", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    await fx.owner.agent.patch("/api/v1/auth/me/preferences").send({ phoneE164: "+14155552671" });
    const client = await fx.client.agent.get("/api/v1/auth/me/preferences");
    expect(client.body.phoneE164).toBeNull();
  });
});

describe("org Slack connection", () => {
  it("configures, hides, and disconnects the webhook", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const orgId = fx.organizationId;
    const before = await fx.owner.agent.get(`/api/v1/organizations/${orgId}`);
    expect(before.body.slackConfigured).toBe(false);
    expect(before.body.slackWebhookUrlSealed).toBeUndefined();

    const saved = await fx.owner.agent.patch(`/api/v1/organizations/${orgId}/slack`).send({ slackWebhookUrl: "http://127.0.0.1:9/hook" });
    expect(saved.status).toBe(200);
    expect(saved.body.slackConfigured).toBe(true);
    expect(saved.body.slackWebhookUrlSealed).toBeUndefined();

    const list = await fx.owner.agent.get("/api/v1/organizations");
    for (const org of list.body.data as Array<Record<string, unknown>>) {
      expect(org.slackWebhookUrlSealed).toBeUndefined();
    }

    const off = await fx.owner.agent.patch(`/api/v1/organizations/${orgId}/slack`).send({ slackWebhookUrl: null });
    expect(off.status).toBe(200);
    expect(off.body.slackConfigured).toBe(false);
  });

  it("rejects bad URLs and non-managers", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const bad = await fx.owner.agent.patch(`/api/v1/organizations/${fx.organizationId}/slack`).send({ slackWebhookUrl: "not-a-url" });
    expect(bad.status).toBe(400);
    const denied = await fx.client.agent.patch(`/api/v1/organizations/${fx.organizationId}/slack`).send({ slackWebhookUrl: "http://127.0.0.1:9/hook" });
    expect(denied.status).toBe(403);
  });
});

describe("channel fan-out", () => {
  it("posts once to Slack and texts each opted-in user", async () => {
    const { app, ctx, store } = createTestApp();
    const fx = await agencyFixture(app);
    await fx.owner.agent.patch(`/api/v1/organizations/${fx.organizationId}/slack`).send({ slackWebhookUrl: "http://127.0.0.1:9/hook" });
    await fx.owner.agent.patch("/api/v1/auth/me/preferences").send({ phoneE164: "+14155552671" });

    await notify(ctx.store, {
      userId: fx.owner.user.id,
      projectId: fx.projectId,
      organizationId: fx.organizationId,
      type: "APPROVAL_REQUESTED",
      title: "Decision needed",
      body: "Please decide",
      link: "/inbox",
      email: { to: "o@test.dev", subject: "s", text: "t" },
    });
    await notify(ctx.store, {
      userId: fx.client.user.id,
      projectId: fx.projectId,
      organizationId: fx.organizationId,
      type: "APPROVAL_REQUESTED",
      title: "Decision needed",
      body: "Please decide",
      link: "/inbox",
      email: { to: "c@test.dev", subject: "s", text: "t" },
    });

    expect(ofType(store, "SLACK", "APPROVAL_REQUESTED")).toHaveLength(1);
    expect(ofType(store, "SMS", "APPROVAL_REQUESTED")).toHaveLength(1);
    expect(ofType(store, "WHATSAPP", "APPROVAL_REQUESTED")).toHaveLength(1);
    expect(ofType(store, "EMAIL", "APPROVAL_REQUESTED")).toHaveLength(2);
  });

  it("skips ineligible types, missing phones, and opted-out users", async () => {
    const { app, ctx, store } = createTestApp();
    const fx = await agencyFixture(app);
    await fx.owner.agent.patch(`/api/v1/organizations/${fx.organizationId}/slack`).send({ slackWebhookUrl: "http://127.0.0.1:9/hook" });

    await notify(ctx.store, {
      userId: fx.owner.user.id,
      projectId: fx.projectId,
      organizationId: fx.organizationId,
      type: "SCOPE_PUBLISHED",
      title: "Published",
      body: "v1 is live",
    });
    expect(ofType(store, "SLACK", "SCOPE_PUBLISHED")).toHaveLength(0);
    expect(ofType(store, "SMS", "SCOPE_PUBLISHED")).toHaveLength(0);
    expect(ofType(store, "WHATSAPP", "SCOPE_PUBLISHED")).toHaveLength(0);

    await notifyChannels(ctx.store, {
      userId: fx.owner.user.id,
      organizationId: fx.organizationId,
      type: "APPROVAL_DECIDED",
      title: "Decided",
      body: "Approved",
      slackKey: "k1",
      userKey: "k1",
    });
    expect(ofType(store, "SLACK", "APPROVAL_DECIDED")).toHaveLength(1);
    expect(ofType(store, "SMS", "APPROVAL_DECIDED")).toHaveLength(0);
    expect(ofType(store, "WHATSAPP", "APPROVAL_DECIDED")).toHaveLength(0);

    await fx.owner.agent.patch("/api/v1/auth/me/preferences").send({ phoneE164: "+14155552671", notifySms: false, notifyWhatsapp: false, notifyEmail: false });
    await notify(ctx.store, {
      userId: fx.owner.user.id,
      projectId: fx.projectId,
      organizationId: fx.organizationId,
      type: "APPROVAL_DECIDED",
      title: "Decided again",
      body: "Approved",
      email: { to: "o@test.dev", subject: "s", text: "t" },
    });
    const emailRows = ofType(store, "EMAIL", "APPROVAL_DECIDED");
    const smsRows = ofType(store, "SMS", "APPROVAL_DECIDED");
    const waRows = ofType(store, "WHATSAPP", "APPROVAL_DECIDED");
    // Only the pre-opt-out Slack-triggering fan-out exists; the opted-out
    // notify added neither email nor texts.
    expect(emailRows).toHaveLength(0);
    expect(smsRows).toHaveLength(0);
    expect(waRows).toHaveLength(0);
  });

  it("dedupes Slack on the event key", async () => {
    const { app, ctx, store } = createTestApp();
    const fx = await agencyFixture(app);
    await fx.owner.agent.patch(`/api/v1/organizations/${fx.organizationId}/slack`).send({ slackWebhookUrl: "http://127.0.0.1:9/hook" });
    const fanout = {
      userId: null,
      organizationId: fx.organizationId,
      type: "APPROVAL_ESCALATED",
      title: "Escalated",
      body: "Overdue",
      slackKey: "esc:1",
      userKey: null,
    };
    await notifyChannels(ctx.store, fanout);
    await notifyChannels(ctx.store, fanout);
    expect(ofType(store, "SLACK", "APPROVAL_ESCALATED")).toHaveLength(1);
  });
});

describe("channel delivery", () => {
  it("delivers Slack/SMS/WhatsApp rows through the worker", async () => {
    const { app, ctx, store } = createTestApp();
    const fx = await agencyFixture(app);
    await fx.owner.agent.patch("/api/v1/auth/me/preferences").send({ phoneE164: "+14155552671" });
    await fx.owner.agent.patch(`/api/v1/organizations/${fx.organizationId}/slack`).send({ slackWebhookUrl: "http://127.0.0.1:9/hook" });
    await notifyChannels(ctx.store, {
      userId: fx.owner.user.id,
      organizationId: fx.organizationId,
      type: "APPROVAL_REQUESTED",
      title: "Decision needed",
      body: "Please decide",
      link: "/inbox",
      slackKey: "send:1",
      userKey: "send:1:owner",
    });
    await drainOnce({ store: ctx.store, env: ctx.env, email: ctx.email, realtime: ctx.realtime, slack: ctx.slack, sms: ctx.sms, whatsapp: ctx.whatsapp });
    for (const row of ofType(store, "SLACK", "APPROVAL_REQUESTED").concat(ofType(store, "SMS", "APPROVAL_REQUESTED"), ofType(store, "WHATSAPP", "APPROVAL_REQUESTED"))) {
      expect(row.status).toBe("SENT");
    }
    expect(ofType(store, "SLACK", "APPROVAL_REQUESTED")).toHaveLength(1);
  });

  it("drops rows whose config vanished and fails unsealable secrets", async () => {
    const { app, ctx, store } = createTestApp();
    const fx = await agencyFixture(app);
    await ctx.store.enqueueOutbox({ type: "SLACK", payload: { organizationId: fx.organizationId, title: "t", body: "b" }, idempotencyKey: null });
    await ctx.store.enqueueOutbox({ type: "SMS", payload: { userId: fx.owner.user.id, body: "b" }, idempotencyKey: null });
    await drainOnce({ store: ctx.store, env: ctx.env, email: ctx.email, realtime: ctx.realtime, slack: ctx.slack, sms: ctx.sms, whatsapp: ctx.whatsapp });
    expect(ofType(store, "SLACK").every((r) => r.status === "SENT")).toBe(true);
    expect(ofType(store, "SMS").every((r) => r.status === "SENT")).toBe(true);

    await fx.owner.agent.patch(`/api/v1/organizations/${fx.organizationId}/slack`).send({ slackWebhookUrl: "http://127.0.0.1:9/hook" });
    await ctx.store.enqueueOutbox({ type: "SLACK", payload: { organizationId: fx.organizationId, title: "t", body: "b" }, idempotencyKey: null });
    await drainOnce({
      store: ctx.store,
      env: { ...ctx.env, AUTH_SECRET: "wrong-secret-value-for-unseal-failure" },
      email: ctx.email,
      realtime: ctx.realtime,
      slack: ctx.slack,
      sms: ctx.sms,
      whatsapp: ctx.whatsapp,
    });
    const failed = ofType(store, "SLACK").filter((r) => r.status === "FAILED");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.attempts).toBe(1);
  });

  it("posts real Slack payloads and honors provider errors", async () => {
    const seen: Array<{ url: string; body: string }> = [];
    const url = await localReceiver(200, seen);
    const driver = createSlackDriver({ NODE_ENV: "test" }, { force: "webhook" });
    await driver.post(url, { text: "*Decision needed*\nPlease decide" });
    expect(seen).toHaveLength(1);
    expect(JSON.parse(seen[0]?.body ?? "{}")).toEqual({ text: "*Decision needed*\nPlease decide" });

    const failing = await localReceiver(500, []);
    await expect(driver.post(failing, { text: "x" })).rejects.toThrowError(/Slack responded 500/);
    expect(createSlackDriver({ NODE_ENV: "development" }).name).toBe("log");
  });

  it("selects log drivers without provider config", () => {
    const { ctx } = createTestApp();
    expect(ctx.sms.name).toBe("log");
    expect(ctx.whatsapp.name).toBe("log");
    expect(createSmsDriver({ ...ctx.env, SMS_API_URL: "https://sms.example/send", SMS_API_KEY: "k" }).name).toBe("http");
    expect(createWhatsappDriver({ ...ctx.env, WHATSAPP_API_URL: "https://wa.example/send", WHATSAPP_API_KEY: "k" }).name).toBe("http");
  });
});

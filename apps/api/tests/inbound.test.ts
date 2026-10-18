import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { agencyFixture, createTestApp, register, type Agent } from "./helpers.js";

const SECRET = "webhook-secret-for-tests";

function signed(payload: Record<string, unknown>, secret = SECRET, timestamp?: number): { body: string; signature: string } {
  const body = JSON.stringify(payload);
  const t = timestamp ?? Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return { body, signature: `t=${t},v1=${v1}` };
}

function email(to: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    messageId: `msg-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    to,
    from: "pat@example.com",
    fromName: "Pat Visitor",
    subject: "Add a booking calendar",
    textBody: "We need a booking calendar on the contact page so visitors can pick a slot without calling us.",
    headers: {},
    attachments: [],
    ...over,
  };
}

async function mailbox(agent: Agent, projectId: string): Promise<{ id: string; address: string }> {
  const res = await agent.post(`/api/v1/projects/${projectId}/inbound-mailboxes`).send({ name: "Support" });
  if (res.status !== 201) throw new Error(`mailbox failed: ${JSON.stringify(res.body)}`);
  return res.body as { id: string; address: string };
}

describe("inbound email", () => {
  it("lets leads manage unguessable aliases", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const box = await mailbox(fx.owner.agent, fx.projectId);
    expect(box.address).toMatch(/^chg-[0-9a-f]{24}@/);
    const list = await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/inbound-mailboxes`);
    expect((list.body as { data: unknown[] }).data).toHaveLength(1);
    expect((await fx.client.agent.get(`/api/v1/projects/${fx.projectId}/inbound-mailboxes`)).status).toBe(403);
    expect((await fx.owner.agent.delete(`/api/v1/inbound-mailboxes/${box.id}`).send({})).status).toBe(200);
    const relist = await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/inbound-mailboxes`);
    expect((relist.body as { data: unknown[] }).data).toHaveLength(0);
  });

  it("ingests signed mail as an unverified SUBMITTED change", async () => {
    const { app, ctx, store } = createTestApp();
    ctx.env.INBOUND_EMAIL_WEBHOOK_SECRET = SECRET;
    const fx = await agencyFixture(app);
    const box = await mailbox(fx.owner.agent, fx.projectId);
    const { body, signature } = signed(email(box.address));
    const res = await request(app)
      .post("/api/v1/webhooks/inbound-email")
      .set("Content-Type", "application/json")
      .set("x-inbound-signature", signature)
      .send(body);
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe("created");

    const changes = await store.listChanges(fx.projectId);
    expect(changes).toHaveLength(1);
    const change = changes[0] as { status: string; source: string; submitterId: null; unverifiedSubmitter: boolean; submitterEmail: string; title: string };
    expect(change.status).toBe("SUBMITTED");
    expect(change.source).toBe("INBOUND_EMAIL");
    expect(change.submitterId).toBeNull();
    expect(change.unverifiedSubmitter).toBe(true);
    expect(change.submitterEmail).toBe("pat@example.com");
    const events = (await store.listAuditEvents({ projectId: fx.projectId, limit: 50 })).items;
    expect(events.some((e) => e.action === "inbound.received")).toBe(true);
    const notes = (await store.listNotifications(fx.owner.user.id, {})).items;
    expect(notes.some((n) => n.type === "INBOUND_RECEIVED")).toBe(true);

    // Provider retries with the same message id do not duplicate.
    const replay = await request(app)
      .post("/api/v1/webhooks/inbound-email")
      .set("Content-Type", "application/json")
      .set("x-inbound-signature", signature)
      .send(body);
    expect((replay.body as { status: string }).status).toBe("duplicate");
    expect(await store.listChanges(fx.projectId)).toHaveLength(1);
  });

  it("rejects bad, stale, and unconfigured signatures", async () => {
    const { app, ctx } = createTestApp();
    ctx.env.INBOUND_EMAIL_WEBHOOK_SECRET = SECRET;
    const fx = await agencyFixture(app);
    const box = await mailbox(fx.owner.agent, fx.projectId);

    const bad = signed(email(box.address), "wrong-secret");
    expect(
      (await request(app).post("/api/v1/webhooks/inbound-email").set("Content-Type", "application/json").set("x-inbound-signature", bad.signature).send(bad.body)).status,
    ).toBe(401);
    const stale = signed(email(box.address), SECRET, Math.floor(Date.now() / 1000) - 3600);
    expect(
      (await request(app).post("/api/v1/webhooks/inbound-email").set("Content-Type", "application/json").set("x-inbound-signature", stale.signature).send(stale.body)).status,
    ).toBe(410);
    expect((await request(app).post("/api/v1/webhooks/inbound-email").set("Content-Type", "application/json").send(JSON.stringify(email(box.address)))).status).toBe(401);

    ctx.env.INBOUND_EMAIL_WEBHOOK_SECRET = "";
    const unconfigured = signed(email(box.address), SECRET);
    expect(
      (await request(app).post("/api/v1/webhooks/inbound-email").set("Content-Type", "application/json").set("x-inbound-signature", unconfigured.signature).send(unconfigured.body)).status,
    ).toBe(422);
  });

  it("drops unknown aliases, loops, and empty bodies without leaking", async () => {
    const { app, ctx, store } = createTestApp();
    ctx.env.INBOUND_EMAIL_WEBHOOK_SECRET = SECRET;
    const fx = await agencyFixture(app);
    const box = await mailbox(fx.owner.agent, fx.projectId);
    const post = async (payload: Record<string, unknown>): Promise<{ status: number; body: unknown }> => {
      const { body, signature } = signed(payload);
      const res = await request(app)
        .post("/api/v1/webhooks/inbound-email")
        .set("Content-Type", "application/json")
        .set("x-inbound-signature", signature)
        .send(body);
      return { status: res.status, body: res.body as unknown };
    };

    const unknown = await post(email("nope@inbound.scopelock.local"));
    expect(unknown.status).toBe(200);
    expect((unknown.body as { reason: string }).reason).toBe("unknown-alias");

    const loop = await post(email(box.address, { headers: { autoSubmitted: "auto-replied" } }));
    expect((loop.body as { reason: string }).reason).toBe("auto-reply");

    const ooo = await post(email(box.address, { subject: "Out of office: back Monday" }));
    expect((ooo.body as { reason: string }).reason).toBe("auto-reply");

    const empty = await post(email(box.address, { subject: "", textBody: "> quoted only\n> nothing new" }));
    expect((empty.body as { reason: string }).reason).toBe("empty-body");

    expect(await store.listChanges(fx.projectId)).toHaveLength(0);
    const metrics = await store.listMetrics(fx.projectId);
    expect(metrics.some((m) => m.name === "inbound.loop_dropped")).toBe(true);
  });

  it("strips quoted history and scans attachments", async () => {
    const { app, ctx, store } = createTestApp();
    ctx.env.INBOUND_EMAIL_WEBHOOK_SECRET = SECRET;
    const fx = await agencyFixture(app);
    const box = await mailbox(fx.owner.agent, fx.projectId);
    const eicar = ["X5O!P%@AP[4", "\\PZX54(P^)7CC)7}$", "EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"].join("");
    const payload = email(box.address, {
      textBody: "Please add SSO.\n\nOn Monday, Support wrote:\n> What do you need?\n-- \nPat",
      attachments: [
        { filename: "notes.txt", contentType: "text/plain", sizeBytes: 11, contentBase64: Buffer.from("hello world").toString("base64") },
        { filename: "evil.txt", contentType: "text/plain", sizeBytes: eicar.length, contentBase64: Buffer.from(eicar).toString("base64") },
      ],
    });
    const { body, signature } = signed(payload);
    const res = await request(app)
      .post("/api/v1/webhooks/inbound-email")
      .set("Content-Type", "application/json")
      .set("x-inbound-signature", signature)
      .send(body);
    expect((res.body as { status: string }).status).toBe("created");
    const changes = await store.listChanges(fx.projectId);
    expect((changes[0] as { description: string }).description).toBe("Please add SSO.");
    const files = await store.listAttachments(fx.projectId);
    const byName = new Map(files.map((f) => [f.fileName, f.status]));
    expect(byName.get("notes.txt")).toBe("READY");
    expect(byName.get("evil.txt")).toBe("QUARANTINED");
    expect(files.every((f) => f.linkedId === changes[0]?.id)).toBe(true);
  });

  it("simulates inbound mail in development and reserves the source", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const stranger = await register(app, { email: "inbound-stranger@other.test", organizationName: "Other" });
    const sim = await fx.owner.agent.post("/api/v1/dev/simulate-inbound-email").send({
      projectId: fx.projectId,
      ...(email("ignored@inbound.scopelock.local") as Record<string, string>),
    });
    expect(sim.status).toBe(201);
    expect(((sim.body as { status: string }).status)).toBe("created");
    expect(
      (await fx.client.agent.post("/api/v1/dev/simulate-inbound-email").send({ projectId: fx.projectId, ...(email("x@y.zz") as Record<string, string>) })).status,
    ).toBe(403);
    expect(
      (await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/change-requests`).send({ title: "t", description: "d", source: "INBOUND_EMAIL" })).status,
    ).toBe(422);
    expect((await stranger.agent.get(`/api/v1/projects/${fx.projectId}/inbound-mailboxes`)).status).toBe(404);
  });
});

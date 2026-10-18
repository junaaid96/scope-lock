import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { agencyFixture, createTestApp, type Agent } from "./helpers.js";

async function enabledFixture(app: Parameters<typeof agencyFixture>[0]) {
  const fx = await agencyFixture(app);
  const patched = await fx.owner.agent.patch(`/api/v1/projects/${fx.projectId}`).send({ externalIntegrationsEnabled: true });
  expect(patched.status).toBe(200);
  return fx;
}

async function makeChange(agent: Agent, projectId: string): Promise<{ id: string; number: string }> {
  const res = await agent.post(`/api/v1/projects/${projectId}/change-requests`).send({
    title: "Linked work",
    description: "Linked work description",
    source: "AGENCY",
  });
  expect(res.status).toBe(201);
  return res.body as { id: string; number: string };
}

async function makeConnection(agent: Agent, projectId: string): Promise<{ id: string; secret: string; webhookUrl: string }> {
  const res = await agent.post(`/api/v1/projects/${projectId}/external-connections`).send({ provider: "GITHUB" });
  expect(res.status).toBe(201);
  const body = res.body as { connection: { id: string }; secret: string; webhookUrl: string };
  return { id: body.connection.id, secret: body.secret, webhookUrl: body.webhookUrl };
}

function sign(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("external connections", () => {
  it("requires the project opt-in, then manages the lifecycle", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const blocked = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/external-connections`).send({ provider: "GITHUB" });
    expect(blocked.status).toBe(422);
    await fx.owner.agent.patch(`/api/v1/projects/${fx.projectId}`).send({ externalIntegrationsEnabled: true });

    const created = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/external-connections`).send({ provider: "GITHUB" });
    expect(created.status).toBe(201);
    const first = created.body as { connection: { id: string; secretSealed?: string }; secret: string; webhookUrl: string };
    expect(first.secret).toMatch(/^ghsec_/);
    expect(first.connection.secretSealed).toBeUndefined();
    expect(first.webhookUrl).toContain(`/api/v1/webhooks/github/${first.connection.id}`);

    const dup = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/external-connections`).send({ provider: "GITHUB" });
    expect(dup.status).toBe(409);

    const list = await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/external-connections`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const rotated = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/external-connections/${first.connection.id}/rotate-secret`);
    expect(rotated.status).toBe(201);
    expect((rotated.body as { secret: string }).secret).not.toBe(first.secret);

    const disabled = await fx.owner.agent
      .patch(`/api/v1/projects/${fx.projectId}/external-connections/${first.connection.id}`)
      .send({ enabled: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.enabled).toBe(false);

    const deleted = await fx.owner.agent.delete(`/api/v1/projects/${fx.projectId}/external-connections/${first.connection.id}`);
    expect(deleted.status).toBe(200);
    const gone = await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/external-connections`);
    expect(gone.body).toHaveLength(0);
  });

  it("rejects clients and cross-project access", async () => {
    const { app } = createTestApp();
    const fx = await enabledFixture(app);
    const denied = await fx.client.agent.post(`/api/v1/projects/${fx.projectId}/external-connections`).send({ provider: "GITHUB" });
    expect(denied.status).toBe(403);
    const missing = await fx.owner.agent
      .patch(`/api/v1/projects/${fx.projectId}/external-connections/exc_nope`)
      .send({ enabled: false });
    expect(missing.status).toBe(404);
  });

  it("lists observed work as a paginated envelope", async () => {
    const { app } = createTestApp();
    const fx = await enabledFixture(app);
    const conn = await makeConnection(fx.owner.agent, fx.projectId);
    const payload = {
      action: "opened",
      repository: { full_name: "octo/repo", default_branch: "main" },
      pull_request: { number: 1, title: "Hello", html_url: "https://github.com/octo/repo/pull/1", merged: false },
    };
    const raw = JSON.stringify(payload);
    const delivered = await request(app)
      .post(`/api/v1/webhooks/github/${conn.id}`)
      .set("X-Hub-Signature-256", sign(conn.secret, raw))
      .set("X-GitHub-Delivery", "deliv-1")
      .set("X-GitHub-Event", "pull_request")
      .set("Content-Type", "application/json")
      .send(raw);
    expect(delivered.status).toBe(200);
    const list = await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/external-work`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].externalId).toBe("octo/repo#1");
    expect(list.body.pagination).toEqual({ nextCursor: null });
  });
});

describe("GitHub webhook receiver", () => {
  it("answers pings after verifying the signature", async () => {
    const { app } = createTestApp();
    const fx = await enabledFixture(app);
    const conn = await makeConnection(fx.owner.agent, fx.projectId);
    const raw = JSON.stringify({ zen: "Keep it logically awesome." });
    const pong = await request(app)
      .post(`/api/v1/webhooks/github/${conn.id}`)
      .set("X-Hub-Signature-256", sign(conn.secret, raw))
      .set("X-GitHub-Delivery", "ping-1")
      .set("X-GitHub-Event", "ping")
      .set("Content-Type", "application/json")
      .send(raw);
    expect(pong.status).toBe(200);
    expect(pong.body).toEqual({ status: "pong" });
    const bad = await request(app)
      .post(`/api/v1/webhooks/github/${conn.id}`)
      .set("X-Hub-Signature-256", "sha256=deadbeef")
      .set("X-GitHub-Delivery", "ping-2")
      .set("X-GitHub-Event", "ping")
      .set("Content-Type", "application/json")
      .send(raw);
    expect(bad.status).toBe(401);
  });

  it("rejects unknown connections, missing deliveries, and malformed payloads", async () => {
    const { app } = createTestApp();
    const fx = await enabledFixture(app);
    const conn = await makeConnection(fx.owner.agent, fx.projectId);
    expect((await request(app).post("/api/v1/webhooks/github/exc_nope")).status).toBe(404);
    const raw = JSON.stringify({ action: "opened" });
    const noDelivery = await request(app)
      .post(`/api/v1/webhooks/github/${conn.id}`)
      .set("X-Hub-Signature-256", sign(conn.secret, raw))
      .set("X-GitHub-Event", "pull_request")
      .set("Content-Type", "application/json")
      .send(raw);
    expect(noDelivery.status).toBe(422);
    const malformed = await request(app)
      .post(`/api/v1/webhooks/github/${conn.id}`)
      .set("X-Hub-Signature-256", sign(conn.secret, raw))
      .set("X-GitHub-Delivery", "bad-1")
      .set("X-GitHub-Event", "pull_request")
      .set("Content-Type", "application/json")
      .send(raw);
    expect(malformed.status).toBe(422);
  });

  it("ignores unknown events and dedupes re-deliveries", async () => {
    const { app } = createTestApp();
    const fx = await enabledFixture(app);
    const conn = await makeConnection(fx.owner.agent, fx.projectId);
    const raw = JSON.stringify({ action: "opened" });
    const headers = {
      "X-Hub-Signature-256": sign(conn.secret, raw),
      "X-GitHub-Delivery": "issues-1",
      "X-GitHub-Event": "issues",
      "Content-Type": "application/json",
    };
    const first = await request(app).post(`/api/v1/webhooks/github/${conn.id}`).set(headers).send(raw);
    expect(first.body.status).toBe("ignored");
    const retry = await request(app).post(`/api/v1/webhooks/github/${conn.id}`).set(headers).send(raw);
    expect(retry.body.status).toBe("duplicate");
  });

  it("drops deliveries for disabled connections", async () => {
    const { app } = createTestApp();
    const fx = await enabledFixture(app);
    const conn = await makeConnection(fx.owner.agent, fx.projectId);
    await fx.owner.agent.patch(`/api/v1/projects/${fx.projectId}/external-connections/${conn.id}`).send({ enabled: false });
    const raw = JSON.stringify({ action: "opened", repository: { full_name: "o/r" }, pull_request: { number: 2, title: "x", html_url: "https://x/2" } });
    const res = await request(app)
      .post(`/api/v1/webhooks/github/${conn.id}`)
      .set("X-Hub-Signature-256", sign(conn.secret, raw))
      .set("X-GitHub-Delivery", "drop-1")
      .set("X-GitHub-Event", "pull_request")
      .set("Content-Type", "application/json")
      .send(raw);
    expect(res.body).toEqual({ status: "dropped", reason: "connection-disabled" });
  });

  it("observes PRs, links resolved changes, and never edits scope", async () => {
    const { app, ctx } = createTestApp();
    const fx = await enabledFixture(app);
    const change = await makeChange(fx.owner.agent, fx.projectId);
    const conn = await makeConnection(fx.owner.agent, fx.projectId);
    const payload = {
      action: "closed",
      repository: { full_name: "octo/repo", default_branch: "main" },
      pull_request: {
        number: 7,
        title: `Ship ${change.number}`,
        body: "Implements the request.",
        html_url: "https://github.com/octo/repo/pull/7",
        merged: true,
        merged_at: "2026-03-01T00:00:00Z",
        head: { ref: "main" },
      },
    };
    const raw = JSON.stringify(payload);
    const res = await request(app)
      .post(`/api/v1/webhooks/github/${conn.id}`)
      .set("X-Hub-Signature-256", sign(conn.secret, raw))
      .set("X-GitHub-Delivery", "pr-7")
      .set("X-GitHub-Event", "pull_request")
      .set("Content-Type", "application/json")
      .send(raw);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", observed: 1, merged: 1, linked: 1 });

    const items = await ctx.store.listExternalWorkItems(fx.projectId);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ externalId: "octo/repo#7", merged: true, refs: [change.number] });
    const links = await ctx.store.listExternalLinks(fx.projectId);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ changeRequestId: change.id, provider: "GITHUB", externalId: "octo/repo#7" });

    // Re-delivery changes nothing (idempotent upsert + link skip).
    const again = await request(app)
      .post(`/api/v1/webhooks/github/${conn.id}`)
      .set("X-Hub-Signature-256", sign(conn.secret, raw))
      .set("X-GitHub-Delivery", "pr-7")
      .set("X-GitHub-Event", "pull_request")
      .set("Content-Type", "application/json")
      .send(raw);
    expect(again.body.status).toBe("duplicate");
    expect(await ctx.store.listExternalWorkItems(fx.projectId)).toHaveLength(1);

    // Scope state is untouched: same status, version, and no decision trail.
    const after = await ctx.store.findChangeById(change.id);
    expect(after?.status).toBe("DRAFT");
    expect(after?.version).toBe(0);
    expect(after?.decidedAt).toBeNull();
  });
});

describe("external health feed", () => {
  it("flags merged unapproved work and unlinked work", async () => {
    const { app } = createTestApp();
    const fx = await enabledFixture(app);
    const change = await makeChange(fx.owner.agent, fx.projectId);
    const conn = await makeConnection(fx.owner.agent, fx.projectId);

    async function deliver(id: string, pr: Record<string, unknown>): Promise<void> {
      const raw = JSON.stringify({
        action: "closed",
        repository: { full_name: "octo/repo", default_branch: "main" },
        pull_request: pr,
      });
      const res = await request(app)
        .post(`/api/v1/webhooks/github/${conn.id}`)
        .set("X-Hub-Signature-256", sign(conn.secret, raw))
        .set("X-GitHub-Delivery", id)
        .set("X-GitHub-Event", "pull_request")
        .set("Content-Type", "application/json")
        .send(raw);
      expect(res.status).toBe(200);
    }

    await deliver("pr-linked", {
      number: 21, title: `Implements ${change.number}`, html_url: "https://github.com/octo/repo/pull/21",
      merged: true, merged_at: "2026-03-02T00:00:00Z", head: { ref: "main" },
    });
    await deliver("pr-orphan", {
      number: 22, title: "Drive-by fix", html_url: "https://github.com/octo/repo/pull/22",
      merged: true, merged_at: "2026-03-02T00:00:00Z", head: { ref: "main" },
    });
    await deliver("pr-open", {
      number: 23, title: "Work in progress", html_url: "https://github.com/octo/repo/pull/23",
      merged: false, head: { ref: "feature" },
    });

    const health = await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/health`);
    expect(health.status).toBe(200);
    const signals = health.body.signals as Array<{ key: string; count: number; itemIds: string[] }>;
    const unapproved = signals.find((s) => s.key === "unapproved");
    expect(unapproved?.itemIds).toContain(change.id);
    const unlinkedWork = signals.find((s) => s.key === "unlinked-work");
    expect(unlinkedWork?.count).toBe(1);
  });
});

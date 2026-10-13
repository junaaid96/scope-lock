import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { getEnv, resetEnvCache } from "../src/env.js";
import { agencyFixture, createTestApp, draftScope, register } from "./helpers.js";

describe("security regression", () => {
  it("blocks cross-tenant ID probing on every resource type", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    const { draftId, version } = await draftScope(fx.owner.agent, fx.projectId);
    await fx.owner.agent.post(`/api/v1/scope-versions/${draftId}/publish`).send({ expectedVersion: version });
    const change = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/change-requests`).send({
      title: "Secret", description: "secret desc", source: "AGENCY",
    });
    const outsider = await register(app, { email: "outsider@test.dev" });

    const probes: Array<[string, string, number]> = [
      ["get", `/api/v1/projects/${fx.projectId}`, 404],
      ["get", `/api/v1/projects/${fx.projectId}/change-requests`, 404],
      ["get", `/api/v1/change-requests/${change.body.id as string}`, 404],
      ["get", `/api/v1/scope-versions/${draftId}`, 404],
      ["get", `/api/v1/projects/${fx.projectId}/scope-versions`, 404],
      ["get", `/api/v1/projects/${fx.projectId}/activity`, 404],
      ["get", `/api/v1/projects/${fx.projectId}/health`, 404],
      ["get", `/api/v1/projects/${fx.projectId}/approval-requests`, 404],
      ["get", `/api/v1/projects/${fx.projectId}/attachments`, 404],
      ["get", `/api/v1/projects/${fx.projectId}/ai/analyses`, 404],
      ["get", `/api/v1/projects/${fx.projectId}/metrics`, 404],
      ["get", `/api/v1/projects/${fx.projectId}/realtime/token`, 404],
      ["get", `/api/v1/organizations/${fx.organizationId}`, 404],
    ];
    for (const probe of probes) {
      const path = probe[1] as string;
      const expected = probe[2] as number;
      const res = await outsider.agent.get(path);
      expect(res.status, path).toBe(expected);
    }
    // Guessing an approval review token fails closed.
    const fake = await request(app).get("/api/v1/approval-requests/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(fake.status).toBe(404);
    void store;
  });

  it("denies client-side roles every agency-only action", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const draft = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/scope-versions/draft`).send({});
    const draftId = draft.body.id as string;
    expect((await fx.client.agent.post(`/api/v1/projects/${fx.projectId}/scope-versions/draft`).send({})).status).toBe(403);
    expect((await fx.client.agent.patch(`/api/v1/scope-versions/${draftId}`).send({ expectedVersion: 0 })).status).toBe(403);
    expect((await fx.client.agent.post(`/api/v1/scope-versions/${draftId}/publish`).send({ expectedVersion: 0 })).status).toBe(403);
    expect((await fx.client.agent.post(`/api/v1/projects/${fx.projectId}/bundles`).send({ name: "x", changeRequestIds: ["y"] })).status).toBe(403);
    expect((await fx.client.agent.post(`/api/v1/projects/${fx.projectId}/external-links`).send({ changeRequestId: "x", provider: "JIRA", externalId: "1" })).status).toBe(403);
    expect((await fx.client.agent.post(`/api/v1/projects/${fx.projectId}/ai/extract-requirements`).send({ sourceText: "x".repeat(50) })).status).toBe(403);
    expect((await fx.client.agent.get(`/api/v1/organizations/${fx.organizationId}/members`)).status).toBe(403);
  });

  it("rejects expired and revoked review tokens", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    const created = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/change-requests`).send({
      title: "T", description: "d", source: "AGENCY",
    });
    const changeId = created.body.id as string;
    let v = created.body.version as number;
    for (const status of ["SUBMITTED", "TRIAGING", "ESTIMATING"]) {
      const res = await fx.owner.agent.patch(`/api/v1/change-requests/${changeId}`).send({ expectedVersion: v, status });
      v = res.body.version as number;
    }
    await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/impact`).send({ effortDays: 1, priceMinor: 1, confidence: "LOW" });
    const send = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const token = ((send.body as { reviewUrls: string[] }).reviewUrls[0] as string).split("/review/")[1] as string;
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const stored = await store.findApprovalTokenByHash(tokenHash);
    expect(stored).toBeTruthy();
    // Expire the token directly, then confirm the link is dead.
    await store.updateApprovalToken(stored?.id as string, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect((await request(app).get(`/api/v1/approval-requests/${token}`)).status).toBe(410);
    // Revocation also closes the link.
    await store.updateApprovalToken(stored?.id as string, {
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      revokedAt: new Date().toISOString(),
    });
    expect((await request(app).get(`/api/v1/approval-requests/${token}`)).status).toBe(404);
    void v;
  });

  it("rejects CSRF-style cross-site cookie posts and accepts bearer posts", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const csrf = await fx.owner.agent
      .post(`/api/v1/projects/${fx.projectId}/decision-notes`)
      .set("Origin", "https://evil.example")
      .send({ targetType: "PROJECT", targetId: fx.projectId, body: "x" });
    expect(csrf.status).toBe(403);
    // Referer is validated the same way when Origin is absent.
    const evilReferer = await fx.owner.agent
      .post(`/api/v1/projects/${fx.projectId}/decision-notes`)
      .set("Referer", "https://evil.example/phish")
      .send({ targetType: "PROJECT", targetId: fx.projectId, body: "x" });
    expect(evilReferer.status).toBe(403);
    const sameOrigin = await fx.owner.agent
      .post(`/api/v1/projects/${fx.projectId}/decision-notes`)
      .set("Origin", "http://localhost:5173")
      .send({ targetType: "PROJECT", targetId: fx.projectId, body: "ok" });
    expect(sameOrigin.status).toBe(201);
    // Bearer (non-browser) clients are unaffected by the Origin check.
    const login = await request(app).post("/api/v1/auth/login").send({ email: "owner@agency.test", password: "password1234" });
    const rawCookies = login.headers["set-cookie"] as unknown as string | string[];
    const firstCookie = Array.isArray(rawCookies) ? rawCookies[0] : rawCookies;
    const cookie = firstCookie?.split(";")[0]?.split("=")[1] as string;
    const bearer = await request(app)
      .post(`/api/v1/projects/${fx.projectId}/decision-notes`)
      .set("Authorization", `Bearer ${cookie}`)
      .set("Origin", "https://evil.example")
      .send({ targetType: "PROJECT", targetId: fx.projectId, body: "via bearer" });
    expect(bearer.status).toBe(201);
  });

  it("returns 401 for invalid sessions and 404 envelopes with correlation ids", async () => {
    const { app } = createTestApp();
    const bad = await request(app).get("/api/v1/auth/me").set("Authorization", "Bearer deadbeef");
    expect(bad.status).toBe(401);
    const missing = await request(app).get("/api/v1/nope");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("NOT_FOUND");
    expect(missing.headers["x-request-id"]).toBe(missing.body.error.correlationId);
    // Client-supplied request id echoes back for support correlation.
    const traced = await request(app).get("/api/v1/nope").set("X-Request-Id", "trace-123");
    expect(traced.body.error.correlationId).toBe("trace-123");
  });

  it("validates every trust-boundary input with structured errors", async () => {
    const { app } = createTestApp();
    const reg = await register(app, { email: "v@test.dev" });
    const badEmail = await request(app).post("/api/v1/auth/register").send({
      name: "x", email: "not-an-email", password: "password1234", organizationName: "o",
    });
    expect(badEmail.status).toBe(400);
    expect(badEmail.body.error.code).toBe("VALIDATION_ERROR");
    expect(badEmail.body.error.details.issues.length).toBeGreaterThan(0);
    const shortPassword = await request(app).post("/api/v1/auth/register").send({
      name: "x", email: "ok@test.dev", password: "short", organizationName: "o",
    });
    expect(shortPassword.status).toBe(400);
    void reg;
  });

  it("stale versions conflict and bad cursors fail closed", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const change = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/change-requests`).send({
      title: "S", description: "d", source: "AGENCY",
    });
    const stale = await fx.owner.agent.patch(`/api/v1/change-requests/${change.body.id as string}`).send({
      expectedVersion: 99, title: "x",
    });
    expect(stale.status).toBe(409);
    const badCursor = await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/activity?cursor=!!!invalid!!!`);
    expect(badCursor.status).toBe(400);
    const badNotif = await fx.owner.agent.get("/api/v1/notifications?cursor=!!!invalid!!!");
    expect(badNotif.status).toBe(400);
  });

  it("never leaks secrets, hashes, or tokens in API responses", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const me = await fx.owner.agent.get("/api/v1/auth/me");
    expect(JSON.stringify(me.body)).not.toMatch(/passwordHash|tokenHash|AUTH_SECRET|GROQ/);
    const members = await fx.owner.agent.get(`/api/v1/organizations/${fx.organizationId}/members`);
    expect(JSON.stringify(members.body)).not.toMatch(/passwordHash|tokenHash/);
    const invites = await fx.owner.agent.get(`/api/v1/organizations/${fx.organizationId}/invitations`);
    expect(JSON.stringify(invites.body)).not.toMatch(/tokenHash/);
  });

  it("fails closed in production with localhost service URLs", () => {
    const saved = { ...process.env };
    try {
      process.env.NODE_ENV = "production";
      process.env.AUTH_SECRET = "x".repeat(32);
      process.env.DATABASE_URL = "postgres://db.internal:5432/scopelock";
      process.env.WEB_URL = "http://localhost:5173";
      process.env.API_URL = "https://api.example.com";
      resetEnvCache();
      expect(() => getEnv()).toThrow(/WEB_URL.*localhost/);
      process.env.WEB_URL = "https://app.example.com";
      process.env.API_URL = "http://127.0.0.1:4000";
      resetEnvCache();
      expect(() => getEnv()).toThrow(/API_URL.*localhost/);
      process.env.API_URL = "https://api.example.com";
      process.env.AUTH_URL = "https://api.example.com";
      resetEnvCache();
      expect(getEnv().NODE_ENV).toBe("production");
    } finally {
      for (const key of Object.keys(process.env)) {
        if (!(key in saved)) delete process.env[key];
      }
      Object.assign(process.env, saved);
      resetEnvCache();
    }
  });
});

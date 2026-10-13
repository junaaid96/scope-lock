import { describe, expect, it } from "vitest";
import request from "supertest";
import { totpCode } from "../src/lib/mfa.js";
import { agencyFixture, createTestApp, register } from "./helpers.js";

describe("auth + organizations", () => {
  it("registers, logs in/out, and serves /me", async () => {
    const { app } = createTestApp();
    const reg = await register(app, { email: "a@test.dev" });
    expect(reg.user.email).toBe("a@test.dev");

    const me = await reg.agent.get("/api/v1/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.organizations[0].role).toBe("OWNER");

    // Plan §9 session alias at the v1 root.
    const alias = await reg.agent.get("/api/v1/me");
    expect(alias.status).toBe(200);
    expect(alias.body).toEqual(me.body);

    const logout = await reg.agent.post("/api/v1/auth/logout");
    expect(logout.status).toBe(200);
    const afterLogout = await reg.agent.get("/api/v1/auth/me");
    expect(afterLogout.status).toBe(401);

    const login = await request(app).post("/api/v1/auth/login").send({ email: "a@test.dev", password: "password1234" });
    expect(login.status).toBe(200);
    const bad = await request(app).post("/api/v1/auth/login").send({ email: "a@test.dev", password: "wrongpassword" });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe("UNAUTHORIZED");
    expect(bad.body.error.correlationId).toBeTruthy();
  });

  it("manages invitations: create, accept, revoke, single-use", async () => {
    const { app } = createTestApp();
    const owner = await register(app, { email: "owner@test.dev" });
    const invite = await owner.agent
      .post(`/api/v1/organizations/${owner.organization.id}/invitations`)
      .send({ email: "new@test.dev", role: "MEMBER" });
    expect(invite.status).toBe(201);
    const token = (invite.body as { token: string }).token;
    expect(token).toBeTruthy();

    const preview = await request(app).get(`/api/v1/auth/invitations/${token}`);
    expect(preview.status).toBe(200);
    expect(preview.body.email).toBe("new@test.dev");

    const newcomer = request.agent(app);
    const accept = await newcomer.post(`/api/v1/auth/invitations/${token}/accept`).send({ name: "New", password: "password1234" });
    expect(accept.status).toBe(200);

    const reuse = await request(app).post(`/api/v1/auth/invitations/${token}/accept`).send({ name: "X", password: "password1234" });
    expect(reuse.status).toBe(404);

    const invite2 = await owner.agent
      .post(`/api/v1/organizations/${owner.organization.id}/invitations`)
      .send({ email: "revoked@test.dev", role: "MEMBER" });
    const revoke = await owner.agent.delete(
      `/api/v1/organizations/${owner.organization.id}/invitations/${(invite2.body as { invitation: { id: string } }).invitation.id}`,
    );
    expect(revoke.status).toBe(200);
    const acceptRevoked = await request(app)
      .post(`/api/v1/auth/invitations/${(invite2.body as { token: string }).token}/accept`)
      .send({ name: "R", password: "password1234" });
    expect(acceptRevoked.status).toBe(404);
  });

  it("rejects invitations for mismatched logged-in users", async () => {
    const { app } = createTestApp();
    const owner = await register(app, { email: "owner2@test.dev" });
    const other = await register(app, { email: "other@test.dev" });
    const invite = await owner.agent
      .post(`/api/v1/organizations/${owner.organization.id}/invitations`)
      .send({ email: "someone@test.dev", role: "MEMBER" });
    const res = await other.agent.post(`/api/v1/auth/invitations/${(invite.body as { token: string }).token}/accept`).send({});
    expect(res.status).toBe(403);
  });

  it("enforces roles and protects the last owner", async () => {
    const { app } = createTestApp();
    const owner = await register(app, { email: "owner3@test.dev" });
    const member = await register(app, { email: "member@test.dev" });
    const invite = await owner.agent
      .post(`/api/v1/organizations/${owner.organization.id}/invitations`)
      .send({ email: "member@test.dev", role: "MEMBER" });
    await member.agent.post(`/api/v1/auth/invitations/${(invite.body as { token: string }).token}/accept`).send({});

    // Member cannot manage members.
    const forbidden = await member.agent.get(`/api/v1/organizations/${owner.organization.id}/members`);
    expect(forbidden.status).toBe(403);

    // Promote then demote works; removing the last owner fails.
    const promote = await owner.agent
      .patch(`/api/v1/organizations/${owner.organization.id}/members/${member.user.id}`)
      .send({ role: "ADMIN" });
    expect(promote.status).toBe(200);
    const demoteOwner = await owner.agent
      .patch(`/api/v1/organizations/${owner.organization.id}/members/${owner.user.id}`)
      .send({ role: "MEMBER" });
    expect(demoteOwner.status).toBe(409);
    const removeOwner = await owner.agent.delete(`/api/v1/organizations/${owner.organization.id}/members/${owner.user.id}`);
    expect(removeOwner.status).toBe(409);
  });

  it("hides other tenants (404, no disclosure)", async () => {
    const { app } = createTestApp();
    const a = await register(app, { email: "a2@test.dev" });
    const b = await register(app, { email: "b2@test.dev" });
    const probe = await b.agent.get(`/api/v1/organizations/${a.organization.id}`);
    expect(probe.status).toBe(404);
    const probeMembers = await b.agent.get(`/api/v1/organizations/${a.organization.id}/members`);
    expect(probeMembers.status).toBe(404);
  });

  it("resets passwords without disclosing account existence", async () => {
    const { app } = createTestApp();
    await register(app, { email: "reset@test.dev" });
    const known = await request(app).post("/api/v1/auth/password-reset/request").send({ email: "reset@test.dev" });
    expect(known.status).toBe(200);
    expect(known.body.resetToken).toBeTruthy();
    const unknown = await request(app).post("/api/v1/auth/password-reset/request").send({ email: "nobody@test.dev" });
    expect(unknown.status).toBe(200);
    expect(unknown.body.resetToken).toBeUndefined();

    const confirm = await request(app).post("/api/v1/auth/password-reset/confirm").send({
      token: known.body.resetToken as string,
      newPassword: "newpassword1234",
    });
    expect(confirm.status).toBe(200);
    const login = await request(app).post("/api/v1/auth/login").send({ email: "reset@test.dev", password: "newpassword1234" });
    expect(login.status).toBe(200);
    // Single-use: replay fails.
    const replay = await request(app).post("/api/v1/auth/password-reset/confirm").send({
      token: known.body.resetToken as string,
      newPassword: "anotherpassword1",
    });
    expect(replay.status).toBe(422);
  });

  it("changes passwords and invalidates other sessions", async () => {
    const { app } = createTestApp();
    const reg = await register(app, { email: "pw@test.dev" });
    const second = request.agent(app);
    await second.post("/api/v1/auth/login").send({ email: "pw@test.dev", password: "password1234" });
    const change = await reg.agent.post("/api/v1/auth/password").send({
      currentPassword: "password1234",
      newPassword: "brandnewpassword",
    });
    expect(change.status).toBe(200);
    expect((await second.get("/api/v1/auth/me")).status).toBe(401);
    expect((await reg.agent.get("/api/v1/auth/me")).status).toBe(200);
  });

  it("serves usage only to admins", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const usage = await fx.owner.agent.get(`/api/v1/organizations/${fx.organizationId}/usage`);
    expect(usage.status).toBe(200);
    expect(usage.body.plan).toBe("FREE");
    expect(usage.body.limits.projects).toBe(3);
    const clientUsage = await fx.client.agent.get(`/api/v1/organizations/${fx.organizationId}/usage`);
    expect(clientUsage.status).toBe(403);
  });

  it("enrolls TOTP, challenges logins, and disables with password", async () => {
    const { app } = createTestApp();
    const reg = await register(app, { email: "mfa@test.dev" });
    // Setup returns a one-time secret; verify requires a valid code.
    const setup = await reg.agent.post("/api/v1/auth/mfa/setup");
    expect(setup.status).toBe(201);
    const secret = (setup.body as { secret: string }).secret;
    expect((setup.body as { otpauthUrl: string }).otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    const badVerify = await reg.agent.post("/api/v1/auth/mfa/verify").send({ code: "000000" });
    expect(badVerify.status).toBe(401);
    const verify = await reg.agent.post("/api/v1/auth/mfa/verify").send({ code: totpCode(secret) });
    expect(verify.status).toBe(200);
    expect((verify.body as { recoveryCodes: string[] }).recoveryCodes).toHaveLength(10);
    const me = await reg.agent.get("/api/v1/auth/me");
    expect((me.body as { user: { mfaEnabled: boolean } }).user.mfaEnabled).toBe(true);

    // Password login now yields a ticket, not a session.
    const fresh = request.agent(app);
    const login = await fresh.post("/api/v1/auth/login").send({ email: "mfa@test.dev", password: "password1234" });
    expect(login.status).toBe(200);
    expect(login.body.mfaRequired).toBe(true);
    expect((await fresh.get("/api/v1/auth/me")).status).toBe(401);
    const badChallenge = await fresh.post("/api/v1/auth/mfa/challenge").send({ ticket: login.body.mfaTicket, code: "000000" });
    expect(badChallenge.status).toBe(401);
    const challenge = await fresh.post("/api/v1/auth/mfa/challenge").send({ ticket: login.body.mfaTicket, code: totpCode(secret) });
    expect(challenge.status).toBe(200);
    expect((await fresh.get("/api/v1/auth/me")).status).toBe(200);

    // Disable requires the password; logins go back to single-step.
    const badDisable = await reg.agent.post("/api/v1/auth/mfa/disable").send({ password: "wrongpassword" });
    expect(badDisable.status).toBe(401);
    expect((await reg.agent.post("/api/v1/auth/mfa/disable").send({ password: "password1234" })).status).toBe(200);
    const plain = await request(app).post("/api/v1/auth/login").send({ email: "mfa@test.dev", password: "password1234" });
    expect(plain.body.mfaRequired).toBeUndefined();
    expect(plain.body.session).toBeTruthy();
  });

  it("accepts single-use recovery codes and consumes them", async () => {
    const { app } = createTestApp();
    const reg = await register(app, { email: "rec@test.dev" });
    const setup = await reg.agent.post("/api/v1/auth/mfa/setup");
    const secret = (setup.body as { secret: string }).secret;
    const verify = await reg.agent.post("/api/v1/auth/mfa/verify").send({ code: totpCode(secret) });
    const codes = (verify.body as { recoveryCodes: string[] }).recoveryCodes;
    const login = await request(app).post("/api/v1/auth/login").send({ email: "rec@test.dev", password: "password1234" });
    const used = await request(app).post("/api/v1/auth/mfa/challenge").send({ ticket: login.body.mfaTicket, code: codes[0] });
    expect(used.status).toBe(200);
    expect(used.body.recoveryCodeUsed).toBe(true);
    expect(used.body.recoveryCodesRemaining).toBe(9);
    // The same code cannot be reused.
    const login2 = await request(app).post("/api/v1/auth/login").send({ email: "rec@test.dev", password: "password1234" });
    const replay = await request(app).post("/api/v1/auth/mfa/challenge").send({ ticket: login2.body.mfaTicket, code: codes[0] });
    expect(replay.status).toBe(401);
  });

  it("exports personal data and deactivates accounts on request", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    const exported = await fx.owner.agent.get("/api/v1/auth/me/export");
    expect(exported.status).toBe(200);
    expect((exported.body as { user: { email: string } }).user.email).toBe("owner@agency.test");
    expect((exported.body as { organizations: unknown[] }).organizations).toHaveLength(1);
    expect((exported.body as { projects: unknown[] }).projects).toHaveLength(1);
    expect(JSON.stringify(exported.body)).not.toMatch(/passwordHash|totpSecretEnc|tokenHash/);

    const badDelete = await fx.owner.agent.delete("/api/v1/auth/me").send({ password: "wrongpassword" });
    expect(badDelete.status).toBe(401);
    const deleted = await fx.owner.agent.delete("/api/v1/auth/me").send({ password: "password1234" });
    expect(deleted.status).toBe(200);
    expect((await fx.owner.agent.get("/api/v1/auth/me")).status).toBe(401);
    const login = await request(app).post("/api/v1/auth/login").send({ email: "owner@agency.test", password: "password1234" });
    expect(login.status).toBe(401);
    const user = await store.findUserByEmail("owner@agency.test");
    expect(user?.status).toBe("DISABLED");
    expect(user?.passwordHash).toBeNull();
  });
});

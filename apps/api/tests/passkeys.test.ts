import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { agencyFixture, createTestApp } from "./helpers.js";

describe("passkeys", () => {
  it("issues registration options and rejects invalid finishes", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);

    const start = await fx.owner.agent.post("/api/v1/auth/passkeys/register/start").send({});
    expect(start.status).toBe(200);
    expect(start.body.challenge).toBeTruthy();
    expect(start.body.rp).toMatchObject({ name: "ScopeLock", id: "localhost" });
    expect(start.headers["set-cookie"]?.join(";")).toContain("webauthn_challenge");

    // Bogus credential with a live challenge cookie fails verification, not auth.
    const bogus = await fx.owner.agent.post("/api/v1/auth/passkeys/register/finish").send({
      name: "Laptop",
      credential: { id: "nope", rawId: "nope", response: {}, type: "public-key" },
    });
    expect(bogus.status).toBe(422);

    // No challenge cookie at all.
    const naked = await request(app).post("/api/v1/auth/passkeys/register/finish").send({
      name: "Laptop",
      credential: {},
    });
    expect(naked.status).toBe(401);
  });

  it("issues login options without enumerating users and rejects unknown credentials", async () => {
    const { app } = createTestApp();
    await agencyFixture(app);

    const known = await request(app).post("/api/v1/auth/passkeys/login/start").send({ email: "owner@agency.test" });
    expect(known.status).toBe(200);
    expect(known.body.challenge).toBeTruthy();
    const unknown = await request(app).post("/api/v1/auth/passkeys/login/start").send({ email: "nobody@example.com" });
    expect(unknown.status).toBe(200);
    expect(unknown.body.challenge).toBeTruthy();
    expect(JSON.stringify(unknown.body)).not.toContain("nobody@example.com");

    const finish = await request(app).post("/api/v1/auth/passkeys/login/finish").send({
      credential: { id: "unknown-credential", response: {} },
    });
    expect(finish.status).toBe(401);
  });

  it("lists without secrets and guards the last login method", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    const created = await store.createPasskey({
      userId: fx.owner.user.id,
      name: "Security key",
      credentialId: "cred-abc",
      publicKey: "cHVibGlj",
      counter: 3,
      transports: ["usb"],
    });
    const listed = await fx.owner.agent.get("/api/v1/auth/passkeys");
    expect(listed.status).toBe(200);
    expect(listed.body.data).toEqual([
      expect.objectContaining({ id: created.id, name: "Security key" }),
    ]);
    expect(JSON.stringify(listed.body)).not.toContain("cHVibGlj");

    // Password user may delete.
    const removed = await fx.owner.agent.delete(`/api/v1/auth/passkeys/${created.id}`);
    expect(removed.status).toBe(204);

    // Passwordless single-passkey user may not delete their last method.
    const bare = await store.createUser({ email: "bare.pk@example.com", name: "Bare", passwordHash: null });
    const only = await store.createPasskey({
      userId: bare.id,
      name: "Only key",
      credentialId: "cred-only",
      publicKey: "eA",
      counter: 0,
      transports: [],
    });
    const token = `pk-token-${Date.now()}`;
    await store.createSession({
      userId: bare.id,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      ip: null,
    });
    const guarded = await request(app).delete(`/api/v1/auth/passkeys/${only.id}`).set("Cookie", `sl_session=${token}`);
    expect(guarded.status).toBe(409);
  });
});

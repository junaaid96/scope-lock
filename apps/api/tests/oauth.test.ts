import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { agencyFixture, createTestApp, register } from "./helpers.js";

const GOOGLE_ID = "test-google-id";
const GOOGLE_SECRET = "test-google-secret";

function withGoogleCreds(): void {
  process.env.GOOGLE_CLIENT_ID = GOOGLE_ID;
  process.env.GOOGLE_CLIENT_SECRET = GOOGLE_SECRET;
}

afterEach(() => {
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  vi.unstubAllGlobals();
});

describe("OAuth login and linking", () => {
  it("reports methods and refuses unconfigured providers", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const methods = await fx.owner.agent.get("/api/v1/auth/methods");
    expect(methods.status).toBe(200);
    expect(methods.body).toEqual({ password: true, google: false, github: false, passkey: true });

    const start = await fx.owner.agent.get("/api/v1/auth/oauth/google/start").redirects(0);
    expect(start.status).toBe(404);

    const callback = await fx.owner.agent.get("/api/v1/auth/oauth/github/callback?code=x&state=y").redirects(0);
    expect(callback.status).toBe(302);
    expect(callback.headers.location as string).toContain("/login?oauthError=invalid");
  });

  it("starts a PKCE request and links on a matching verified email", async () => {
    withGoogleCreds();
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);

    const start = await fx.owner.agent.get("/api/v1/auth/oauth/google/start").redirects(0);
    expect(start.status).toBe(302);
    const location = new URL(start.headers.location as string);
    expect(location.hostname).toBe("accounts.google.com");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("code_challenge")).toBeTruthy();
    const state = location.searchParams.get("state") as string;

    const fetchStub = vi.fn(async (input: unknown) => {
      const url = String(input instanceof URL ? input.href : (input as Request).url ?? input);
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "tok", token_type: "Bearer", expires_in: 3600 }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("openidconnect.googleapis.com")) {
        return new Response(
          JSON.stringify({ sub: "google-uid-1", email: "owner@agency.test", email_verified: true }),
          { headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchStub);

    const callback = await fx.owner.agent
      .get(`/api/v1/auth/oauth/google/callback?code=fakecode&state=${state}`)
      .redirects(0);
    expect(callback.status).toBe(302);
    expect(callback.headers.location as string).toContain("/?linked=google");

    const accounts = await fx.owner.agent.get("/api/v1/auth/oauth/accounts");
    expect(accounts.status).toBe(200);
    expect(accounts.body.data).toEqual([
      expect.objectContaining({ provider: "google", email: "owner@agency.test" }),
    ]);
    const events = await store.listAuditEvents({ organizationId: fx.organizationId, limit: 50 });
    expect(events.items.some((e) => e.action === "oauth.linked")).toBe(true);
  });

  it("logs in through a prior link and still enforces MFA", async () => {
    withGoogleCreds();
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    await store.createOAuthAccount({
      userId: fx.owner.user.id,
      provider: "google",
      providerUserId: "google-uid-2",
      email: "owner@agency.test",
    });
    // Logged-out agent starts the login flow (no session).
    const loggedOut = await register(app, { email: "bystander.oauth@example.com", organizationName: "Tmp" });
    await loggedOut.agent.post("/api/v1/auth/logout");
    const start = await loggedOut.agent.get("/api/v1/auth/oauth/google/start").redirects(0);
    expect(start.status).toBe(302);
    const state = new URL(start.headers.location as string).searchParams.get("state") as string;

    const fetchStub = vi.fn(async (input: unknown) => {
      const url = String(input instanceof URL ? input.href : (input as Request).url ?? input);
      if (url.includes("oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "tok", token_type: "Bearer", expires_in: 3600 }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({ sub: "google-uid-2", email: "owner@agency.test", email_verified: true }),
        { headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchStub);

    const callback = await loggedOut.agent
      .get(`/api/v1/auth/oauth/google/callback?code=fakecode&state=${state}`)
      .redirects(0);
    expect(callback.status).toBe(302);
    expect(callback.headers.location as string).toBe("http://localhost:5173/");

    // MFA-enabled users get a ticket redirect, not a session.
    await store.updateUser(fx.owner.user.id, { mfaEnabled: true, totpSecretEnc: "x", mfaRecoveryHashes: [] });
    const loggedOut2 = await register(app, { email: "bystander2.oauth@example.com", organizationName: "Tmp2" });
    await loggedOut2.agent.post("/api/v1/auth/logout");
    const start2 = await loggedOut2.agent.get("/api/v1/auth/oauth/google/start").redirects(0);
    const state2 = new URL(start2.headers.location as string).searchParams.get("state") as string;
    const callback2 = await loggedOut2.agent
      .get(`/api/v1/auth/oauth/google/callback?code=fakecode&state=${state2}`)
      .redirects(0);
    expect(callback2.status).toBe(302);
    expect(callback2.headers.location as string).toContain("/login?mfaTicket=");
  });

  it("rejects mismatched emails, unknown identities, and last-method unlink", async () => {
    withGoogleCreds();
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);

    // Link flow with a non-matching verified email.
    const start = await fx.owner.agent.get("/api/v1/auth/oauth/google/start").redirects(0);
    const state = new URL(start.headers.location as string).searchParams.get("state") as string;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input instanceof URL ? input.href : (input as Request).url ?? input);
        if (url.includes("oauth2.googleapis.com/token")) {
          return new Response(JSON.stringify({ access_token: "tok", token_type: "Bearer", expires_in: 3600 }), {
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ sub: "google-stranger", email: "stranger@example.com", email_verified: true }), {
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const mismatch = await fx.owner.agent
      .get(`/api/v1/auth/oauth/google/callback?code=fakecode&state=${state}`)
      .redirects(0);
    expect(mismatch.headers.location as string).toContain("oauthError=mismatch");
    expect(await store.listOAuthAccounts(fx.owner.user.id)).toHaveLength(0);

    // Unlink guards: password users may unlink; passwordless single-method users may not.
    await store.createOAuthAccount({
      userId: fx.owner.user.id,
      provider: "google",
      providerUserId: "google-uid-3",
      email: "owner@agency.test",
    });
    const unlinked = await fx.owner.agent.delete("/api/v1/auth/oauth/accounts/google");
    expect(unlinked.status).toBe(204);

    const bare = await store.createUser({ email: "bare.oauth@example.com", name: "Bare", passwordHash: null });
    await store.createOAuthAccount({
      userId: bare.id,
      provider: "github",
      providerUserId: "gh-1",
      email: "bare.oauth@example.com",
    });
    const token = `bare-token-${Date.now()}`;
    await store.createSession({
      userId: bare.id,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      ip: null,
    });
    const guarded = await request(app).delete("/api/v1/auth/oauth/accounts/github").set("Cookie", `sl_session=${token}`);
    expect(guarded.status).toBe(409);
  });
});

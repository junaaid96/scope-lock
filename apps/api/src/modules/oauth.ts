// Google/GitHub OAuth login and account linking (authorization code + PKCE
// via openid-client). Anti-takeover rules: links are created only for
// provider-verified emails, linking requires the address to match the
// signed-in user, and login requires a prior link — unknown provider
// identities never mint sessions. MFA (TOTP) still gates OAuth logins.

import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { OAuthProviderSchema } from "@scopelock/contracts";
import { DomainError } from "@scopelock/domain";
import type { AppContext } from "../app-context.js";
import { asyncHandler } from "../http/errors.js";
import { authenticate, requireAuth, setSessionCookie } from "../http/auth.js";
import { rateLimit } from "../http/rate-limit.js";
import { validateParams } from "../http/validate.js";
import type { ApiRequest } from "../http/types.js";
import { auditUser } from "../lib/audit.js";
import { issueMfaTicket, sealSecret, unsealSecret } from "../lib/mfa.js";
import { callbackUrl, credentialsFor, githubCredentials, googleCredentials } from "../lib/login-methods.js";
import { exchangeCode, startAuthorization, type OAuthProvider } from "../lib/oauth.js";
import { startSession } from "./auth.js";

const STATE_COOKIE = "oauth_state";
const STATE_TTL_MS = 10 * 60_000;

interface StatePayload {
  state: string;
  verifier: string;
  provider: OAuthProvider;
  /** Set when the flow started from an authenticated session (linking). */
  userId: string | null;
  exp: number;
}

function setStateCookie(res: Response, sealed: string): void {
  res.cookie(STATE_COOKIE, sealed, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: STATE_TTL_MS,
    path: "/api/v1/auth/oauth",
  });
}

function clearStateCookie(res: Response): void {
  res.clearCookie(STATE_COOKIE, { path: "/api/v1/auth/oauth" });
}

function readState(authSecret: string, req: Request): StatePayload | null {
  const sealed = (req.cookies as Record<string, string | undefined> | undefined)?.[STATE_COOKIE];
  if (!sealed) return null;
  const raw = unsealSecret(authSecret, sealed);
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw) as StatePayload;
    if (payload.exp <= Date.now() || !payload.state || !payload.verifier) return null;
    return payload;
  } catch {
    return null;
  }
}

function loginRedirect(env: { WEB_URL: string }, params: string): string {
  return `${env.WEB_URL.replace(/\/$/, "")}/login${params}`;
}

export function oauthRoutes(ctx: AppContext): Router {
  const router = Router();
  const authLimit = rateLimit(ctx.env, "auth");

  router.get("/auth/methods", (_req, res) => {
    res.json({
      password: true,
      google: googleCredentials() !== null,
      github: githubCredentials() !== null,
      passkey: true,
    });
  });

  router.get(
    "/auth/oauth/:provider/start",
    authLimit,
    authenticate(ctx.store),
    validateParams(z.object({ provider: OAuthProviderSchema })),
    asyncHandler(async (req, res) => {
      const provider = req.params.provider as OAuthProvider;
      const creds = credentialsFor(provider);
      if (!creds) throw DomainError.notFound("This login method is not configured");
      const auth = (req as ApiRequest).auth;
      const { url, state, verifier } = await startAuthorization({
        provider,
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        redirectUri: callbackUrl(ctx.env, provider),
      });
      const payload: StatePayload = {
        state,
        verifier,
        provider,
        userId: auth?.user.id ?? null,
        exp: Date.now() + STATE_TTL_MS,
      };
      setStateCookie(res, sealSecret(ctx.env.AUTH_SECRET, JSON.stringify(payload)));
      res.redirect(302, url);
    }),
  );

  router.get(
    "/auth/oauth/:provider/callback",
    authLimit,
    authenticate(ctx.store),
    validateParams(z.object({ provider: OAuthProviderSchema })),
    asyncHandler(async (req, res) => {
      const provider = req.params.provider as OAuthProvider;
      const failed = (flag: string): void => {
        clearStateCookie(res);
        res.redirect(302, loginRedirect(ctx.env, `?oauthError=${flag}`));
      };
      const creds = credentialsFor(provider);
      const saved = readState(ctx.env.AUTH_SECRET, req);
      if (!creds || !saved || saved.provider !== provider) {
        failed("invalid");
        return;
      }
      if (typeof req.query.error === "string") {
        failed("denied");
        return;
      }
      let verified: { providerUserId: string; email: string };
      try {
        verified = await exchangeCode(
          {
            provider,
            clientId: creds.clientId,
            clientSecret: creds.clientSecret,
            redirectUri: callbackUrl(ctx.env, provider),
          },
          `${ctx.env.API_URL.replace(/\/$/, "")}${req.originalUrl}`,
          saved.state,
          saved.verifier,
        );
      } catch {
        failed("failed");
        return;
      }
      clearStateCookie(res);
      const auth = (req as ApiRequest).auth;

      // Link flow: started from a session; the session must be the same user
      // and the verified address must match their account address.
      if (saved.userId) {
        if (!auth || auth.user.id !== saved.userId || auth.user.email.toLowerCase() !== verified.email) {
          failed("mismatch");
          return;
        }
        const dupe = await ctx.store.findOAuthAccount(provider, verified.providerUserId);
        if (dupe) {
          failed(dupe.userId === auth.user.id ? "linked" : "taken");
          return;
        }
        await ctx.store.createOAuthAccount({
          userId: auth.user.id,
          provider,
          providerUserId: verified.providerUserId,
          email: verified.email,
        });
        await auditUser(ctx.store, auth.user.id, auth.user.email, "oauth.linked", undefined, { provider });
        res.redirect(302, `${ctx.env.WEB_URL.replace(/\/$/, "")}/?linked=${provider}`);
        return;
      }

      // Login flow: a prior link is required; unknown identities never log in.
      const link = await ctx.store.findOAuthAccount(provider, verified.providerUserId);
      const user = link ? await ctx.store.findUserById(link.userId) : null;
      if (!link || !user || user.status !== "ACTIVE") {
        failed("nolink");
        return;
      }
      if (user.mfaEnabled) {
        const ticket = issueMfaTicket(ctx.env.AUTH_SECRET, user.id);
        res.redirect(302, loginRedirect(ctx.env, `?mfaTicket=${encodeURIComponent(ticket)}`));
        return;
      }
      const { token, expiresAt } = await startSession(ctx, req as ApiRequest, user.id);
      setSessionCookie(res, ctx.env, token, expiresAt);
      await auditUser(ctx.store, user.id, user.email, "oauth.login", undefined, { provider });
      res.redirect(302, `${ctx.env.WEB_URL.replace(/\/$/, "")}/`);
    }),
  );

  router.get(
    "/auth/oauth/accounts",
    authenticate(ctx.store),
    requireAuth,
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const accounts = await ctx.store.listOAuthAccounts(auth.user.id);
      res.json({
        data: accounts.map((a) => ({ provider: a.provider, email: a.email, createdAt: a.createdAt })),
      });
    }),
  );

  router.delete(
    "/auth/oauth/accounts/:provider",
    authenticate(ctx.store),
    requireAuth,
    validateParams(z.object({ provider: OAuthProviderSchema })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const provider = req.params.provider as OAuthProvider;
      const accounts = await ctx.store.listOAuthAccounts(auth.user.id);
      const target = accounts.find((a) => a.provider === provider);
      if (!target) throw DomainError.notFound("No linked account for this provider");
      const user = await ctx.store.findUserById(auth.user.id);
      const passkeys = await ctx.store.listPasskeys(auth.user.id);
      const otherLinks = accounts.filter((a) => a.provider !== provider);
      if (!user?.passwordHash && otherLinks.length === 0 && passkeys.length === 0) {
        throw DomainError.conflict("Cannot unlink your only login method");
      }
      await ctx.store.deleteOAuthAccount(target.id);
      await auditUser(ctx.store, auth.user.id, auth.user.email, "oauth.unlinked", { provider });
      res.status(204).send();
    }),
  );

  return router;
}

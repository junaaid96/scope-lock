// Passkey (WebAuthn) registration and login. Challenges travel in sealed,
// short-lived cookies so no ceremony state touches the stores. MFA policy:
// a passkey login starts a session directly only when the authenticator
// reports user verification; otherwise MFA-enabled users fall back to TOTP.

import { Router } from "express";
import { z } from "zod";
import { PasskeyLoginFinishSchema, PasskeyLoginStartSchema, RegisterPasskeySchema } from "@scopelock/contracts";
import { DomainError } from "@scopelock/domain";
import type { AppContext } from "../app-context.js";
import { publicUser } from "../app-context.js";
import { asyncHandler } from "../http/errors.js";
import { authenticate, requireAuth, setSessionCookie } from "../http/auth.js";
import { rateLimit } from "../http/rate-limit.js";
import { validateBody, validateParams } from "../http/validate.js";
import type { ApiRequest } from "../http/types.js";
import { auditUser } from "../lib/audit.js";
import { issueMfaTicket } from "../lib/mfa.js";
import {
  authenticationOptions,
  clearChallengeCookie,
  registrationOptions,
  sealChallenge,
  setChallengeCookie,
  toB64Url,
  unsealChallenge,
  verifyAuthentication,
  verifyRegistration,
  WEBAUTHN_CHALLENGE_COOKIE,
} from "../lib/webauthn.js";
import { startSession } from "./auth.js";

export function passkeyRoutes(ctx: AppContext): Router {
  const router = Router();
  const authLimit = rateLimit(ctx.env, "auth");

  router.get(
    "/auth/passkeys",
    authenticate(ctx.store),
    requireAuth,
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const keys = await ctx.store.listPasskeys(auth.user.id);
      res.json({
        data: keys.map((k) => ({ id: k.id, name: k.name, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt })),
      });
    }),
  );

  router.delete(
    "/auth/passkeys/:id",
    authenticate(ctx.store),
    requireAuth,
    validateParams(z.object({ id: z.string().min(1) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const keys = await ctx.store.listPasskeys(auth.user.id);
      const target = keys.find((k) => k.id === (req.params.id as string));
      if (!target) throw DomainError.notFound("Passkey not found");
      const user = await ctx.store.findUserById(auth.user.id);
      const links = await ctx.store.listOAuthAccounts(auth.user.id);
      if (!user?.passwordHash && links.length === 0 && keys.length <= 1) {
        throw DomainError.conflict("Cannot delete your only login method");
      }
      await ctx.store.deletePasskey(target.id);
      await auditUser(ctx.store, auth.user.id, auth.user.email, "passkey.deleted", { name: target.name });
      res.status(204).send();
    }),
  );

  router.post(
    "/auth/passkeys/register/start",
    authenticate(ctx.store),
    requireAuth,
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const existing = await ctx.store.listPasskeys(auth.user.id);
      const options = await registrationOptions(auth.user.id, auth.user.email, existing.map((k) => k.credentialId));
      setChallengeCookie(res, sealChallenge(ctx.env.AUTH_SECRET, options.challenge, auth.user.id, "register"));
      res.json(options);
    }),
  );

  router.post(
    "/auth/passkeys/register/finish",
    authenticate(ctx.store),
    requireAuth,
    validateBody(RegisterPasskeySchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof RegisterPasskeySchema>;
      const sealed = (req.cookies as Record<string, string | undefined> | undefined)?.[WEBAUTHN_CHALLENGE_COOKIE];
      const saved = unsealChallenge(ctx.env.AUTH_SECRET, sealed, "register");
      if (!saved || saved.userId !== auth.user.id) {
        throw DomainError.unauthorized("Passkey ceremony expired or is invalid. Start again.");
      }
      let verified;
      try {
        verified = await verifyRegistration(input.credential, saved.challenge);
      } catch {
        throw DomainError.unprocessable("Passkey registration could not be verified");
      }
      if (!verified.verified || !verified.registrationInfo) {
        throw DomainError.unprocessable("Passkey registration could not be verified");
      }
      const credentialId = verified.registrationInfo.credential.id;
      const dupe = await ctx.store.findPasskeyByCredentialId(credentialId);
      if (dupe) throw DomainError.conflict("This passkey is already registered");
      const created = await ctx.store.createPasskey({
        userId: auth.user.id,
        name: input.name,
        credentialId,
        publicKey: toB64Url(verified.registrationInfo.credential.publicKey),
        counter: verified.registrationInfo.credential.counter,
        transports: [],
      });
      clearChallengeCookie(res);
      await auditUser(ctx.store, auth.user.id, auth.user.email, "passkey.registered", undefined, {
        name: created.name,
        userVerified: verified.registrationInfo.userVerified,
      });
      res.status(201).json({ id: created.id, name: created.name, createdAt: created.createdAt, lastUsedAt: null });
    }),
  );

  router.post(
    "/auth/passkeys/login/start",
    authLimit,
    validateBody(PasskeyLoginStartSchema),
    asyncHandler(async (req, res) => {
      const input = req.body as z.infer<typeof PasskeyLoginStartSchema>;
      // Same response shape whether or not the email exists (no enumeration).
      const user = input.email ? await ctx.store.findUserByEmail(input.email.toLowerCase()) : null;
      const allow = user && user.status === "ACTIVE" ? (await ctx.store.listPasskeys(user.id)).map((k) => k.credentialId) : [];
      const options = await authenticationOptions(allow);
      setChallengeCookie(res, sealChallenge(ctx.env.AUTH_SECRET, options.challenge, user?.id ?? null, "login"));
      res.json(options);
    }),
  );

  router.post(
    "/auth/passkeys/login/finish",
    authLimit,
    validateBody(PasskeyLoginFinishSchema),
    asyncHandler(async (req, res) => {
      const input = req.body as z.infer<typeof PasskeyLoginFinishSchema>;
      const sealed = (req.cookies as Record<string, string | undefined> | undefined)?.[WEBAUTHN_CHALLENGE_COOKIE];
      const saved = unsealChallenge(ctx.env.AUTH_SECRET, sealed, "login");
      if (!saved) throw DomainError.unauthorized("Passkey ceremony expired or is invalid. Start again.");
      const credentialId = (input.credential as { id?: unknown } | null)?.id;
      if (typeof credentialId !== "string") throw DomainError.unauthorized("Invalid passkey response");
      // Credential IDs are base64url; normalize padding-tolerant input.
      const stored = await ctx.store.findPasskeyByCredentialId(credentialId);
      if (!stored || (saved.userId && stored.userId !== saved.userId)) {
        throw DomainError.unauthorized("Invalid email or passkey");
      }
      const user = await ctx.store.findUserById(stored.userId);
      if (!user || user.status !== "ACTIVE") throw DomainError.unauthorized("Invalid email or passkey");
      let verified;
      try {
        verified = await verifyAuthentication(input.credential, saved.challenge, {
          credentialId: stored.credentialId,
          publicKey: stored.publicKey,
          counter: stored.counter,
          transports: stored.transports,
        });
      } catch {
        throw DomainError.unauthorized("Invalid email or passkey");
      }
      if (!verified.verified) throw DomainError.unauthorized("Invalid email or passkey");
      const { newCounter, userVerified } = verified.authenticationInfo;
      // Counter must advance; a repeat is a cloned-authenticator signal, not a login.
      if (newCounter <= stored.counter && newCounter !== 0 && stored.counter !== 0) {
        throw DomainError.unauthorized("Invalid email or passkey");
      }
      await ctx.store.updatePasskeyCounter(stored.id, newCounter, new Date().toISOString());
      clearChallengeCookie(res);
      if (user.mfaEnabled && !userVerified) {
        res.json({ mfaRequired: true, mfaTicket: issueMfaTicket(ctx.env.AUTH_SECRET, user.id) });
        return;
      }
      const { token, expiresAt } = await startSession(ctx, req as ApiRequest, user.id);
      setSessionCookie(res, ctx.env, token, expiresAt);
      const organizations = await ctx.store.listOrganizationsForUser(user.id);
      await auditUser(ctx.store, user.id, user.email, "passkey.login", undefined, { userVerified });
      res.json({
        user: publicUser(user),
        organizations: organizations.map((o) => ({ id: o.id, name: o.name })),
        session: { expiresAt: expiresAt.toISOString() },
      });
    }),
  );

  return router;
}

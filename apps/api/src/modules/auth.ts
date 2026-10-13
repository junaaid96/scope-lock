import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import {
  ChangePasswordSchema,
  DeleteAccountSchema,
  LoginSchema,
  MfaChallengeSchema,
  MfaDisableSchema,
  MfaVerifySchema,
  PasswordResetConfirmSchema,
  PasswordResetRequestSchema,
  RegisterSchema,
} from "@scopelock/contracts";
import { DomainError, newToken, sha256Hex } from "@scopelock/domain";
import type { AppContext } from "../app-context.js";
import { publicUser } from "../app-context.js";
import { asyncHandler } from "../http/errors.js";
import { authenticate, clearSessionCookie, requireAuth, setSessionCookie } from "../http/auth.js";
import { rateLimit } from "../http/rate-limit.js";
import { validateBody, validateParams } from "../http/validate.js";
import type { ApiRequest } from "../http/types.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  issueMfaTicket,
  otpauthUrl,
  sealSecret,
  unsealSecret,
  verifyMfaTicket,
  verifyTotp,
} from "../lib/mfa.js";
import { audit } from "../lib/audit.js";
import { nowIso } from "../store/index.js";

function sessionExpiry(envHours: number): Date {
  return new Date(Date.now() + envHours * 3_600_000);
}

async function startSession(ctx: AppContext, req: ApiRequest, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = sessionExpiry(ctx.env.SESSION_TTL_HOURS);
  await ctx.store.createSession({
    userId,
    tokenHash: sha256Hex(token),
    expiresAt: expiresAt.toISOString(),
    ip: req.ip ?? null,
  });
  return { token, expiresAt };
}

/** Session profile payload, shared by GET /auth/me and the GET /me alias. */
export function sessionMeHandler(ctx: AppContext) {
  return async (req: Request, res: Response): Promise<void> => {
    const auth = (req as ApiRequest).auth;
    if (!auth) throw DomainError.unauthorized("Authentication required");
    const organizations = await ctx.store.listOrganizationsForUser(auth.user.id);
    const memberships = await Promise.all(organizations.map((o) => ctx.store.findMembership(o.id, auth.user.id)));
    res.json({
      user: publicUser(auth.user),
      organizations: organizations.map((o, i) => ({
        id: o.id,
        name: o.name,
        plan: o.plan,
        role: memberships[i]?.role ?? null,
      })),
    });
  };
}

export function authRoutes(ctx: AppContext): Router {
  const router = Router();
  const authLimit = rateLimit(ctx.env, "auth");

  router.post(
    "/register",
    authLimit,
    authenticate(ctx.store),
    validateBody(RegisterSchema),
    asyncHandler(async (req, res) => {
      const input = req.body as z.infer<typeof RegisterSchema>;
      const existing = await ctx.store.findUserByEmail(input.email);
      if (existing) throw DomainError.conflict("An account with this email already exists");
      const result = await ctx.store.transaction(async (tx) => {
        const user = await tx.createUser({
          email: input.email,
          name: input.name,
          passwordHash: await hashPassword(input.password),
        });
        const organization = await tx.createOrganization({ name: input.organizationName });
        const membership = await tx.upsertMembership(organization.id, user.id, "OWNER");
        return { user, organization, membership };
      });
      await audit(ctx.store, {
        organizationId: result.organization.id,
        actorId: result.user.id,
        actorEmail: result.user.email,
        action: "organization.created",
        targetType: "ORGANIZATION",
        targetId: result.organization.id,
        after: { name: result.organization.name },
      });
      const { token, expiresAt } = await startSession(ctx, req as ApiRequest, result.user.id);
      setSessionCookie(res, ctx.env, token, expiresAt);
      res.status(201).json({
        user: publicUser(result.user),
        organization: result.organization,
        role: result.membership.role,
        session: { expiresAt: expiresAt.toISOString() },
      });
    }),
  );

  router.post(
    "/login",
    authLimit,
    validateBody(LoginSchema),
    asyncHandler(async (req, res) => {
      const input = req.body as z.infer<typeof LoginSchema>;
      const user = await ctx.store.findUserByEmail(input.email);
      const valid = user?.passwordHash ? await verifyPassword(input.password, user.passwordHash) : false;
      if (!user || !valid || user.status !== "ACTIVE") {
        // Generic message: never disclose whether the email exists.
        throw DomainError.unauthorized("Invalid email or password");
      }
      if (user.mfaEnabled) {
        // Password passed: issue a short-lived ticket for the TOTP challenge.
        // No session exists until the second factor verifies.
        res.json({ mfaRequired: true, mfaTicket: issueMfaTicket(ctx.env.AUTH_SECRET, user.id) });
        return;
      }
      const { token, expiresAt } = await startSession(ctx, req as ApiRequest, user.id);
      setSessionCookie(res, ctx.env, token, expiresAt);
      const organizations = await ctx.store.listOrganizationsForUser(user.id);
      res.json({
        user: publicUser(user),
        organizations: organizations.map((o) => ({ id: o.id, name: o.name })),
        session: { expiresAt: expiresAt.toISOString() },
      });
    }),
  );

  router.post(
    "/logout",
    authenticate(ctx.store),
    requireAuth,
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (auth) await ctx.store.deleteSession(auth.sessionId);
      clearSessionCookie(res, ctx.env);
      res.json({ ok: true });
    }),
  );

  router.get("/me", authenticate(ctx.store), requireAuth, asyncHandler(sessionMeHandler(ctx)));

  router.patch(
    "/me",
    authenticate(ctx.store),
    requireAuth,
    validateBody(z.object({ name: z.string().min(1).max(120) })),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const updated = await ctx.store.updateUser(auth.user.id, { name: (req.body as { name: string }).name });
      res.json({ user: publicUser(updated) });
    }),
  );

  router.post(
    "/password",
    authLimit,
    authenticate(ctx.store),
    requireAuth,
    validateBody(ChangePasswordSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof ChangePasswordSchema>;
      const user = await ctx.store.findUserById(auth.user.id);
      if (!user?.passwordHash || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
        throw DomainError.unauthorized("Current password is incorrect");
      }
      await ctx.store.updateUser(user.id, { passwordHash: await hashPassword(input.newPassword) });
      await ctx.store.deleteUserSessions(user.id, auth.sessionId);
      res.json({ ok: true });
    }),
  );

  router.post(
    "/password-reset/request",
    authLimit,
    validateBody(PasswordResetRequestSchema),
    asyncHandler(async (req, res) => {
      const { email } = req.body as z.infer<typeof PasswordResetRequestSchema>;
      const user = await ctx.store.findUserByEmail(email);
      // Always respond 200 — never disclose whether the email exists.
      if (user) {
        const token = newToken();
        await ctx.store.createPasswordReset({
          userId: user.id,
          tokenHash: sha256Hex(token),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        });
        const link = `${ctx.env.WEB_URL}/reset-password?token=${token}`;
        await ctx.store.enqueueOutbox({
          type: "EMAIL",
          payload: {
            to: user.email,
            subject: "Reset your ScopeLock password",
            text: `Reset your password (expires in 1 hour): ${link}`,
            notificationType: "PASSWORD_RESET",
          },
          idempotencyKey: `pwreset:${sha256Hex(token)}`,
        });
        if (ctx.env.NODE_ENV !== "production") {
          res.json({ ok: true, resetToken: token });
          return;
        }
      }
      res.json({ ok: true });
    }),
  );

  router.post(
    "/password-reset/confirm",
    authLimit,
    validateBody(PasswordResetConfirmSchema),
    asyncHandler(async (req, res) => {
      const input = req.body as z.infer<typeof PasswordResetConfirmSchema>;
      const record = await ctx.store.findPasswordResetByTokenHash(sha256Hex(input.token));
      if (!record || record.usedAt || record.expiresAt <= nowIso()) {
        throw DomainError.unprocessable("This reset link is invalid or has expired");
      }
      await ctx.store.transaction(async (tx) => {
        await tx.updateUser(record.userId, { passwordHash: await hashPassword(input.newPassword) });
        await tx.markPasswordResetUsed(record.id, nowIso());
        await tx.deleteUserSessions(record.userId);
      });
      res.json({ ok: true });
    }),
  );

  router.get(
    "/invitations/:token",
    rateLimit(ctx.env, "token"),
    validateParams(z.object({ token: z.string().min(20) })),
    asyncHandler(async (req, res) => {
      const invite = await ctx.store.findInvitationByTokenHash(sha256Hex(req.params.token as string));
      if (!invite || invite.status !== "PENDING" || invite.expiresAt <= nowIso()) {
        throw DomainError.notFound("Invitation not found");
      }
      const org = await ctx.store.findOrganizationById(invite.organizationId);
      res.json({
        email: invite.email,
        role: invite.role,
        organizationName: org?.name ?? "ScopeLock",
        projectId: invite.projectId,
        projectRole: invite.projectRole,
        expiresAt: invite.expiresAt,
      });
    }),
  );

  router.post(
    "/invitations/:token/accept",
    authLimit,
    authenticate(ctx.store),
    validateParams(z.object({ token: z.string().min(20) })),
    validateBody(z.object({ name: z.string().min(1).max(120).optional(), password: z.string().min(10).max(200).optional() })),
    asyncHandler(async (req, res) => {
      const invite = await ctx.store.findInvitationByTokenHash(sha256Hex(req.params.token as string));
      if (!invite || invite.status !== "PENDING") throw DomainError.notFound("Invitation not found");
      if (invite.expiresAt <= nowIso()) {
        await ctx.store.updateInvitation(invite.id, { status: "EXPIRED", decidedAt: nowIso() });
        throw DomainError.gone("This invitation has expired");
      }
      const auth = (req as ApiRequest).auth;
      const body = req.body as { name?: string; password?: string };
      let user = auth?.user ?? null;
      if (user && user.email.toLowerCase() !== invite.email.toLowerCase()) {
        throw DomainError.forbidden("This invitation was sent to a different email address");
      }
      const result = await ctx.store.transaction(async (tx) => {
        if (!user) {
          const byEmail = await tx.findUserByEmail(invite.email);
          if (byEmail) throw DomainError.forbidden("An account with this email exists — please log in first");
          if (!body.name || !body.password) {
            throw DomainError.unprocessable("Name and password are required to accept this invitation");
          }
          user = await tx.createUser({ email: invite.email, name: body.name, passwordHash: await hashPassword(body.password) });
        }
        const accepted = user;
        await tx.upsertMembership(invite.organizationId, accepted.id, invite.role);
        if (invite.projectId && invite.projectRole) {
          await tx.upsertProjectMember(invite.projectId, accepted.id, invite.projectRole);
        }
        await tx.updateInvitation(invite.id, { status: "ACCEPTED", decidedAt: nowIso() });
        return accepted;
      });
      await audit(ctx.store, {
        organizationId: invite.organizationId,
        projectId: invite.projectId,
        actorId: result.id,
        actorEmail: result.email,
        action: "invitation.accepted",
        targetType: "INVITATION",
        targetId: invite.id,
        after: { role: invite.role, projectRole: invite.projectRole },
      });
      if (!auth) {
        const { token, expiresAt } = await startSession(ctx, req as ApiRequest, result.id);
        setSessionCookie(res, ctx.env, token, expiresAt);
      }
      res.json({ user: publicUser(result), organizationId: invite.organizationId });
    }),
  );

  // ----- Multi-factor authentication (TOTP) -----

  router.post(
    "/mfa/setup",
    authLimit,
    authenticate(ctx.store),
    requireAuth,
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const user = await ctx.store.findUserById(auth.user.id);
      if (!user) throw DomainError.unauthorized("Authentication required");
      if (user.mfaEnabled) throw DomainError.conflict("Multi-factor authentication is already enabled");
      const secret = generateTotpSecret();
      await ctx.store.updateUser(user.id, { totpSecretEnc: sealSecret(ctx.env.AUTH_SECRET, secret) });
      // Shown once: the user enrolls their authenticator app, then verifies.
      res.status(201).json({ secret, otpauthUrl: otpauthUrl(secret, user.email) });
    }),
  );

  router.post(
    "/mfa/verify",
    authLimit,
    authenticate(ctx.store),
    requireAuth,
    validateBody(MfaVerifySchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof MfaVerifySchema>;
      const user = await ctx.store.findUserById(auth.user.id);
      const plain = user?.totpSecretEnc ? unsealSecret(ctx.env.AUTH_SECRET, user.totpSecretEnc) : null;
      if (!user || !plain || !verifyTotp(plain, input.code)) {
        throw DomainError.unauthorized("Invalid verification code");
      }
      const recoveryCodes = generateRecoveryCodes();
      await ctx.store.updateUser(user.id, {
        mfaEnabled: true,
        mfaRecoveryHashes: recoveryCodes.map(hashRecoveryCode),
      });
      const orgId = (await ctx.store.listOrganizationsForUser(user.id))[0]?.id;
      if (!orgId) {
        res.json({ ok: true, recoveryCodes });
        return;
      }
      await audit(ctx.store, {
        organizationId: orgId,
        actorId: user.id,
        actorEmail: user.email,
        action: "mfa.enabled",
        targetType: "USER",
        targetId: user.id,
      });
      // Recovery codes are shown once and stored only as hashes.
      res.json({ ok: true, recoveryCodes });
    }),
  );

  router.post(
    "/mfa/disable",
    authLimit,
    authenticate(ctx.store),
    requireAuth,
    validateBody(MfaDisableSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof MfaDisableSchema>;
      const user = await ctx.store.findUserById(auth.user.id);
      if (!user?.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) {
        throw DomainError.unauthorized("Password is incorrect");
      }
      await ctx.store.updateUser(user.id, { mfaEnabled: false, totpSecretEnc: null, mfaRecoveryHashes: [] });
      const orgId = (await ctx.store.listOrganizationsForUser(user.id))[0]?.id;
      if (!orgId) {
        res.json({ ok: true });
        return;
      }
      await audit(ctx.store, {
        organizationId: orgId,
        actorId: user.id,
        actorEmail: user.email,
        action: "mfa.disabled",
        targetType: "USER",
        targetId: user.id,
      });
      res.json({ ok: true });
    }),
  );

  router.post(
    "/mfa/challenge",
    authLimit,
    validateBody(MfaChallengeSchema),
    asyncHandler(async (req, res) => {
      const input = req.body as z.infer<typeof MfaChallengeSchema>;
      const userId = verifyMfaTicket(ctx.env.AUTH_SECRET, input.ticket);
      const user = userId ? await ctx.store.findUserById(userId) : null;
      if (!user || !user.mfaEnabled || user.status !== "ACTIVE") {
        throw DomainError.unauthorized("This MFA ticket is invalid or has expired");
      }
      const plain = user.totpSecretEnc ? unsealSecret(ctx.env.AUTH_SECRET, user.totpSecretEnc) : null;
      let consumedRecovery = false;
      if (plain && verifyTotp(plain, input.code)) {
        // Second factor verified.
      } else {
        // Fall back to single-use recovery codes.
        const hash = hashRecoveryCode(input.code);
        const remaining = (user.mfaRecoveryHashes ?? []).filter((h) => h !== hash);
        if (remaining.length === (user.mfaRecoveryHashes ?? []).length) {
          throw DomainError.unauthorized("Invalid MFA code");
        }
        await ctx.store.updateUser(user.id, { mfaRecoveryHashes: remaining });
        consumedRecovery = true;
      }
      const { token, expiresAt } = await startSession(ctx, req as ApiRequest, user.id);
      setSessionCookie(res, ctx.env, token, expiresAt);
      const organizations = await ctx.store.listOrganizationsForUser(user.id);
      res.json({
        user: publicUser(user),
        organizations: organizations.map((o) => ({ id: o.id, name: o.name })),
        session: { expiresAt: expiresAt.toISOString() },
        recoveryCodeUsed: consumedRecovery,
        recoveryCodesRemaining: consumedRecovery ? (user.mfaRecoveryHashes ?? []).length - 1 : undefined,
      });
    }),
  );

  // ----- Data portability / deletion -----

  router.get(
    "/me/export",
    authenticate(ctx.store),
    requireAuth,
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const user = await ctx.store.findUserById(auth.user.id);
      if (!user) throw DomainError.unauthorized("Authentication required");
      const organizations = await ctx.store.listOrganizationsForUser(user.id);
      const memberships = await Promise.all(organizations.map((o) => ctx.store.findMembership(o.id, user.id)));
      const projectIds = await ctx.store.listProjectIdsForUser(user.id);
      const projectRoles = await Promise.all(projectIds.map((p) => ctx.store.findProjectMember(p, user.id)));
      const notifications = await ctx.store.listNotifications(user.id, { limit: 100 });
      res.json({
        exportedAt: new Date().toISOString(),
        user: publicUser(user),
        organizations: organizations.map((o, i) => ({ id: o.id, name: o.name, plan: o.plan, role: memberships[i]?.role ?? null })),
        projects: projectIds.map((id, i) => ({ id, role: projectRoles[i]?.role ?? null })),
        notifications: notifications.items,
      });
    }),
  );

  router.delete(
    "/me",
    authLimit,
    authenticate(ctx.store),
    requireAuth,
    validateBody(DeleteAccountSchema),
    asyncHandler(async (req, res) => {
      const auth = (req as ApiRequest).auth;
      if (!auth) throw DomainError.unauthorized("Authentication required");
      const input = req.body as z.infer<typeof DeleteAccountSchema>;
      const user = await ctx.store.findUserById(auth.user.id);
      if (!user?.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) {
        throw DomainError.unauthorized("Password is incorrect");
      }
      // Deactivation (not hard delete): the audit trail must stay reconstructible.
      // Operators can hard-delete PII per docs/OPERATIONS.md after retention review.
      const orgs = await ctx.store.listOrganizationsForUser(user.id);
      await ctx.store.transaction(async (tx) => {
        await tx.updateUser(user.id, {
          status: "DISABLED",
          passwordHash: null,
          mfaEnabled: false,
          totpSecretEnc: null,
          mfaRecoveryHashes: [],
        });
        await tx.deleteUserSessions(user.id);
        if (orgs[0]) {
          await audit(tx, {
            organizationId: orgs[0].id,
            actorId: user.id,
            actorEmail: user.email,
            action: "user.deactivated",
            targetType: "USER",
            targetId: user.id,
          });
        }
      });
      clearSessionCookie(res, ctx.env);
      res.json({ ok: true });
    }),
  );

  return router;
}

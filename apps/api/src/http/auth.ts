import type { NextFunction, Response } from "express";
import { DomainError, sha256Hex } from "@scopelock/domain";
import type { Env } from "../env.js";
import type { Store } from "../store/index.js";
import { getContext } from "../context.js";
import { sendError } from "./errors.js";
import { checkApiKeyLimit } from "./rate-limit.js";
import type { ApiRequest, AuthInfo } from "./types.js";

const SESSION_COOKIE = "sl_session";

function bearerToken(req: ApiRequest): string | null {
  const header = req.headers.authorization;
  if (!header || !header.toLowerCase().startsWith("bearer ")) return null;
  return header.slice(7).trim() || null;
}

/**
 * Loads the session when credentials are present. Public routes call this too
 * (it never rejects); protected routes add requireAuth().
 */
export function authenticate(store: Store) {
  return async (req: ApiRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const cookieToken = req.cookies?.[SESSION_COOKIE] as string | undefined;
      const bearer = bearerToken(req);
      // API keys ride the Bearer scheme with an `sk_` prefix. A missing key
      // falls through to the session lookup: session tokens are random, so a
      // session token could theoretically start with `sk_` too.
      if (bearer?.startsWith("sk_")) {
        const key = await store.findApiKeyByHash(sha256Hex(bearer));
        const now = new Date().toISOString();
        const user = key ? await store.findUserById(key.userId) : null;
        if (key && !key.revokedAt && (!key.expiresAt || key.expiresAt > now) && user && user.status === "ACTIVE") {
          const env = req.app?.get?.("scopelock.env") as Env | undefined;
          if (env && !env.RATE_LIMIT_DISABLED) {
            const verdict = checkApiKeyLimit(key.id, { max: env.API_KEY_RATE_LIMIT_PER_MIN, windowMs: 60_000 });
            if (!verdict.ok) {
              res.setHeader("Retry-After", String(verdict.retryAfterSec));
              sendError(res, 429, "RATE_LIMITED", "API key quota exceeded, please slow down");
              return;
            }
          }
          req.auth = { user, sessionId: `key:${key.id}`, viaCookie: false, apiKeyId: key.id, scopes: key.scopes };
          const ctx = getContext();
          if (ctx) {
            ctx.userId = user.id;
            ctx.scopes = key.scopes;
          }
          // Throttle last-used writes to one per minute.
          if (!key.lastUsedAt || Date.parse(key.lastUsedAt) < Date.now() - 60_000) {
            await store.updateApiKey(key.id, { lastUsedAt: now }).catch(() => undefined);
          }
          next();
          return;
        }
      }
      const raw = cookieToken ?? bearer;
      if (!raw) {
        next();
        return;
      }
      const session = await store.findSessionByTokenHash(sha256Hex(raw));
      if (!session || session.expiresAt <= new Date().toISOString()) {
        if (session) await store.deleteSession(session.id).catch(() => undefined);
        next();
        return;
      }
      const user = await store.findUserById(session.userId);
      if (!user || user.status !== "ACTIVE") {
        next();
        return;
      }
      const auth: AuthInfo = { user, sessionId: session.id, viaCookie: cookieToken !== undefined, apiKeyId: null, scopes: null };
      req.auth = auth;
      const ctx = getContext();
      if (ctx) ctx.userId = user.id;
      // Throttle last-seen writes to one per minute.
      if (Date.parse(session.lastSeenAt) < Date.now() - 60_000) {
        await store.touchSession(session.id, new Date().toISOString()).catch(() => undefined);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Origin of a Referer header, or null when absent/unparseable. */
function refererOrigin(referer: string | undefined): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

export function requireAuth(req: ApiRequest, _res: Response, next: NextFunction): void {
  if (!req.auth) {
    next(DomainError.unauthorized("Authentication required"));
    return;
  }
  // CSRF protection for cookie-authenticated mutations: browsers attach Origin
  // on cross-site POSTs, so a disallowed Origin with cookie credentials is
  // rejected. Bearer-authenticated (non-browser) clients are unaffected.
  if (req.auth.viaCookie && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const env = req.app?.get?.("scopelock.env") as Env | undefined;
    const allowed = new Set([env?.WEB_URL, env?.API_URL].filter((u): u is string => Boolean(u)));
    const origin = req.headers.origin ?? refererOrigin(req.headers.referer);
    if (origin) {
      if (allowed.size === 0 || !allowed.has(origin)) {
        next(DomainError.forbidden("Cross-site request rejected"));
        return;
      }
    } else if (env?.NODE_ENV === "production") {
      // Browsers always send Origin (or Referer) on cookie-authenticated
      // mutations; a missing value in production is treated as cross-site.
      next(DomainError.forbidden("Cross-site request rejected"));
      return;
    }
  }
  next();
}

export function sessionCookieName(): string {
  return SESSION_COOKIE;
}

export function setSessionCookie(res: Response, env: Env, token: string, expiresAt: Date): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: Response, env: Env): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
  });
}

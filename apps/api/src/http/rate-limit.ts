import type { NextFunction, Response } from "express";
import type { Env } from "../env.js";
import { logger } from "../logger.js";
import type { ApiRequest } from "./types.js";
import { sendError } from "./errors.js";

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export type RateLimitGroup = "auth" | "token" | "ai" | "default";

const LIMITS: Record<RateLimitGroup, { max: number; windowMs: number }> = {
  auth: { max: 30, windowMs: 60_000 },
  token: { max: 60, windowMs: 60_000 },
  ai: { max: 30, windowMs: 60_000 },
  default: { max: 600, windowMs: 60_000 },
};

function clientKey(req: ApiRequest): string {
  const forwarded = req.headers["x-forwarded-for"];
  const ip =
    (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0]?.trim()) ??
    req.ip ??
    "unknown";
  return ip;
}

/** Fixed-window in-memory rate limiter (single-process; use a shared store for multi-instance). */
export function rateLimit(env: Env, group: RateLimitGroup = "default") {
  const { max, windowMs } = LIMITS[group];
  return (req: ApiRequest, res: Response, next: NextFunction): void => {
    if (env.RATE_LIMIT_DISABLED) {
      next();
      return;
    }
    const key = `${group}:${clientKey(req)}`;
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfter));
      // Redacted abuse signal: method/path/group only, never tokens or cookies.
      logger.warn("Rate limit exceeded", { group, method: req.method, path: req.path });
      sendError(res, 429, "RATE_LIMITED", "Too many requests, please slow down");
      return;
    }
    next();
  };
}

/** Test helper. */
export function resetRateLimits(): void {
  buckets.clear();
}

/**
 * Per-API-key fixed window (checked inside authenticate(), after the key
 * resolves). Returns false when the key is over its budget.
 */
export function checkApiKeyLimit(
  apiKeyId: string,
  opts: { max: number; windowMs: number } = { max: 300, windowMs: 60_000 },
): { ok: boolean; retryAfterSec: number } {
  const key = `apikey:${apiKeyId}`;
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return { ok: true, retryAfterSec: 0 };
  }
  bucket.count += 1;
  if (bucket.count > opts.max) {
    return { ok: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfterSec: 0 };
}

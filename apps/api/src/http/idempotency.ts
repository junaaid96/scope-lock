import type { NextFunction, Response } from "express";
import type { Store } from "../store/index.js";
import type { ApiRequest } from "./types.js";

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Honors `Idempotency-Key` on consequential POSTs (publish, decision, invite,
 * send). Replays the stored response when the same key+scope repeats.
 */
export function idempotency(store: Store, scope: string) {
  return (req: ApiRequest, res: Response, next: NextFunction): void => {
    const key = req.headers["idempotency-key"];
    if (typeof key !== "string" || key.length === 0 || key.length > 128) {
      next();
      return;
    }
    const actor = req.auth?.user.id ?? "anon";
    const namespaced = `${scope}:${actor}`;
    void (async () => {
      const existing = await store.findIdempotency(key, namespaced);
      if (existing && existing.expiresAt > new Date().toISOString()) {
        res.setHeader("Idempotency-Replayed", "true");
        res.status(existing.statusCode).json(existing.body);
        return;
      }
      const originalJson = res.json.bind(res) as (body: unknown) => Response;
      res.json = ((body: unknown) => {
        void store
          .saveIdempotency({
            key,
            scope: namespaced,
            statusCode: res.statusCode,
            body,
            expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString(),
          })
          .catch(() => undefined);
        return originalJson(body);
      }) as typeof res.json;
      next();
    })().catch(next);
  };
}

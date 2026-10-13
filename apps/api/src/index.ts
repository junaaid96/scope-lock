import { existsSync, readFileSync } from "node:fs";
import { createApp } from "./app.js";
import type { AppContext } from "./app-context.js";
import { getEnv } from "./env.js";
import { createEmailDriver } from "./lib/email.js";
import { createRealtimeDriver } from "./lib/realtime.js";
import { createStorageDriver } from "./lib/storage.js";
import { startWorker, drainOnce } from "./lib/worker.js";
import { logger } from "./logger.js";
import { createStore } from "./store/index.js";

/** Minimal .env loader (no dependency): only fills variables that are unset. */
function loadDotEnv(path: string): void {
  try {
    if (!existsSync(path)) return;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [key, ...rest] = trimmed.split("=");
      const k = key?.trim();
      if (!k || process.env[k] !== undefined) continue;
      let v = rest.join("=").trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[k] = v;
    }
  } catch {
    // A missing/unreadable .env must not crash the server.
  }
}

async function main(): Promise<void> {
  loadDotEnv(".env");
  loadDotEnv("../../.env");
  const env = getEnv();
  const store = await createStore(env);
  const ctx: AppContext = {
    store,
    env,
    email: createEmailDriver(env),
    storage: createStorageDriver(env),
    realtime: createRealtimeDriver(env),
  };
  const stopWorker = startWorker({ store, env, email: ctx.email, realtime: ctx.realtime, storage: ctx.storage });
  // One immediate drain so invitations/approvals created while idle still send.
  if (env.OUTBOX_AUTODRAIN && env.NODE_ENV !== "test") {
    drainOnce({ store, env, email: ctx.email, realtime: ctx.realtime, storage: ctx.storage }).catch(() => undefined);
  }
  const app = createApp(ctx);
  const server = app.listen(env.PORT, () => {
    logger.info("ScopeLock API listening", { port: env.PORT, env: env.NODE_ENV });
  });
  const shutdown = (): void => {
    stopWorker();
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main().catch((err: unknown) => {
  logger.error("Fatal startup error", { message: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});

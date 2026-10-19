// Vercel serverless entry for the ScopeLock API (Express app from apps/api).
// Built output (apps/api/dist) is produced by the project's build command.
import { waitUntil } from "@vercel/functions";
import { createApp } from "../apps/api/dist/app.js";
import { getEnv } from "../apps/api/dist/env.js";
import { createEmailDriver } from "../apps/api/dist/lib/email.js";
import { createRealtimeDriver } from "../apps/api/dist/lib/realtime.js";
import { createSlackDriver } from "../apps/api/dist/lib/slack.js";
import { createSmsDriver, createWhatsappDriver } from "../apps/api/dist/lib/sms.js";
import { createStorageDriver } from "../apps/api/dist/lib/storage.js";
import { drainOnce } from "../apps/api/dist/lib/worker.js";
import { logger } from "../apps/api/dist/logger.js";
import { createStore } from "../apps/api/dist/store/index.js";

let ready;
let lastDrain = 0;
const DRAIN_EVERY_MS = 15_000;

async function init() {
  const env = getEnv();
  const store = await createStore(env);
  const ctx = {
    store,
    env,
    email: createEmailDriver(env),
    storage: createStorageDriver(env),
    realtime: createRealtimeDriver(env),
    slack: createSlackDriver(env),
    sms: createSmsDriver(env),
    whatsapp: createWhatsappDriver(env),
  };
  const deps = { store, env, email: ctx.email, realtime: ctx.realtime, slack: ctx.slack, sms: ctx.sms, whatsapp: ctx.whatsapp, storage: ctx.storage };
  return { app: createApp(ctx), env, deps };
}

export default async function handler(req, res) {
  ready ??= init().catch((err) => {
    ready = undefined;
    throw err;
  });
  let state;
  try {
    state = await ready;
  } catch (err) {
    logger.error("Fatal startup error", { message: err instanceof Error ? err.message : String(err) });
    res.statusCode = 503;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: { code: "UNAVAILABLE", message: "Service starting up failed", correlationId: "" } }));
    return;
  }
  // No long-lived worker on serverless: drain the outbox opportunistically
  // after responses, at most once per DRAIN_EVERY_MS per instance.
  if (state.env.OUTBOX_AUTODRAIN && Date.now() - lastDrain > DRAIN_EVERY_MS) {
    lastDrain = Date.now();
    waitUntil(drainOnce(state.deps).catch((err) => logger.error("Worker drain failed", { message: String(err) })));
  }
  return state.app(req, res);
}

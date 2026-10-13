import { getContext } from "./context.js";

type Level = "debug" | "info" | "warn" | "error";

const SENSITIVE_KEYS = new Set([
  "password",
  "currentPassword",
  "newPassword",
  "token",
  "session",
  "authorization",
  "cookie",
  "groq_api_key",
  "api_key",
  "secret",
  "uploadUrl",
  "downloadUrl",
  "prompt",
]);

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.has(k.toLowerCase()) ? "[redacted]" : redact(v);
    }
    return out;
  }
  return value;
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (process.env.NODE_ENV === "test" && level === "debug") return;
  const ctx = getContext();
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg,
      correlationId: ctx?.correlationId,
      userId: ctx?.userId,
      ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
    }),
  );
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
};

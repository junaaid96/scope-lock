import { randomBytes } from "node:crypto";
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_URL: z.string().url().default("http://localhost:5173"),
  API_URL: z.string().url().default("http://localhost:4000"),
  DATA_FILE: z.string().default("./data/scopelock.json"),
  DATABASE_URL: z.string().default(""),
  DIRECT_URL: z.string().default(""),
  AUTH_SECRET: z.string().default(""),
  AUTH_URL: z.string().url().default("http://localhost:4000"),
  AUTH_CLIENT_ID: z.string().default(""),
  AUTH_CLIENT_SECRET: z.string().default(""),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(168),
  GROQ_API_KEY: z.string().default(""),
  GROQ_MODEL: z.string().default("openai/gpt-oss-120b"),
  OPENAI_API_KEY: z.string().default(""),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  AI_PROVIDER: z.enum(["groq", "openai"]).default("groq"),
  AI_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),
  R2_ACCOUNT_ID: z.string().default(""),
  R2_ACCESS_KEY_ID: z.string().default(""),
  R2_SECRET_ACCESS_KEY: z.string().default(""),
  R2_BUCKET_NAME: z.string().default(""),
  R2_ENDPOINT: z.string().default(""),
  UPLOAD_DIR: z.string().default("./data/uploads"),
  MALWARE_SCANNER_URL: z
    .string()
    .default("")
    .refine((v) => v === "" || URL.canParse(v), "MALWARE_SCANNER_URL must be a valid URL"),
  PENDING_UPLOAD_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  DELETED_FILE_PURGE_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  ABLY_API_KEY: z.string().default(""),
  EMAIL_API_KEY: z.string().default(""),
  EMAIL_FROM: z.string().default(""),
  INBOUND_EMAIL_DOMAIN: z.string().default("inbound.scopelock.local"),
  INBOUND_EMAIL_WEBHOOK_SECRET: z.string().default(""),
  SENTRY_DSN: z.string().default(""),
  RATE_LIMIT_DISABLED: z
    .string()
    .default("")
    .transform((v) => v === "1" || v.toLowerCase() === "true"),
  OUTBOX_AUTODRAIN: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const env = parsed.data;
  // Fail closed in production: no default/empty auth secret, explicit URLs required.
  if (env.NODE_ENV === "production") {
    if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) {
      throw new Error("AUTH_SECRET must be set (>= 32 chars) in production");
    }
    if (!env.DATABASE_URL) throw new Error("DATABASE_URL must be set in production");
    // Localhost callback/origin URLs in production break CSRF/CORS assumptions.
    for (const key of ["WEB_URL", "API_URL", "AUTH_URL"] as const) {
      if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/i.test(env[key])) {
        throw new Error(`${key} must not be a localhost URL in production`);
      }
    }
  }
  if (!env.AUTH_SECRET) {
    // Dev/test fallback: random per-process secret (sessions do not survive restarts).
    env.AUTH_SECRET = randomBytes(48).toString("hex");
  }
  return env;
}

let cached: Env | null = null;
export function getEnv(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}

/** Test-only reset so each test file can reconfigure the environment. */
export function resetEnvCache(): void {
  cached = null;
}

export function usesPrisma(env: Env): boolean {
  return /^postgres(ql)?:\/\//.test(env.DATABASE_URL);
}

export function usesR2(env: Env): boolean {
  return Boolean(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET_NAME);
}

export function usesAbly(env: Env): boolean {
  return Boolean(env.ABLY_API_KEY);
}

export function usesEmailApi(env: Env): boolean {
  return Boolean(env.EMAIL_API_KEY && env.EMAIL_FROM);
}

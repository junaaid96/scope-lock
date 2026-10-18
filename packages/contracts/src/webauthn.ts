import { z } from "zod";
import { IdSchema } from "./common.js";

// ---------- OAuth + passkeys ----------

export const OAuthProviderSchema = z.enum(["google", "github"]);

export const AuthMethodsSchema = z.object({
  password: z.literal(true),
  google: z.boolean(),
  github: z.boolean(),
  passkey: z.boolean(),
});

export const OAuthAccountViewSchema = z.object({
  provider: OAuthProviderSchema,
  email: z.string(),
  createdAt: z.string(),
});

export const OAuthAccountsResponseSchema = z.object({
  data: z.array(OAuthAccountViewSchema),
});

export const RegisterPasskeySchema = z.object({
  name: z.string().min(1).max(80),
  /** Attestation response; cryptographically verified server-side. */
  credential: z.unknown(),
});

export const PasskeyViewSchema = z.object({
  id: IdSchema,
  name: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});

export const PasskeysResponseSchema = z.object({
  data: z.array(PasskeyViewSchema),
});

export const PasskeyLoginStartSchema = z.object({
  email: z.string().email().max(320).optional(),
});

export const PasskeyLoginFinishSchema = z.object({
  /** Assertion response; cryptographically verified server-side. */
  credential: z.unknown(),
});

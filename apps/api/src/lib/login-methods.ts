// Login-method configuration, read from process env (kept out of env.ts so
// the pre-existing uncommitted hunks there stay untouched). Every method is
// disabled unless its credentials are present — local runs are unaffected.

import type { Env } from "../env.js";
import type { OAuthProvider } from "./oauth.js";

export interface ProviderCredentials {
  clientId: string;
  clientSecret: string;
}

export function googleCredentials(): ProviderCredentials | null {
  const clientId = (process.env.GOOGLE_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET ?? "").trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function githubCredentials(): ProviderCredentials | null {
  const clientId = (process.env.GITHUB_CLIENT_ID ?? "").trim();
  const clientSecret = (process.env.GITHUB_CLIENT_SECRET ?? "").trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function credentialsFor(provider: OAuthProvider): ProviderCredentials | null {
  return provider === "google" ? googleCredentials() : githubCredentials();
}

/** Callback URL the API exposes for a provider (must match the provider app settings). */
export function callbackUrl(env: Env, provider: OAuthProvider): string {
  return `${env.API_URL.replace(/\/$/, "")}/api/v1/auth/oauth/${provider}/callback`;
}

/** Relying-party identity for WebAuthn. RP ID must be the registrable host (or localhost). */
export function webAuthnRp(): { rpID: string; rpName: string; origin: string } {
  const rpID = (process.env.WEBAUTHN_RP_ID ?? "").trim() || "localhost";
  const rpName = (process.env.WEBAUTHN_RP_NAME ?? "").trim() || "ScopeLock";
  const origin = (process.env.WEB_URL ?? "").trim() || "http://localhost:5173";
  return { rpID, rpName, origin };
}

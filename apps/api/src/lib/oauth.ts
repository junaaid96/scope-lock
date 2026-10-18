import {
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  ClientSecretBasic,
  Configuration,
  fetchUserInfo,
  randomPKCECodeVerifier,
  randomState,
  skipSubjectCheck,
  type ServerMetadata,
} from "openid-client";

export type OAuthProvider = "google" | "github";

const GOOGLE_METADATA: ServerMetadata = {
  issuer: "https://accounts.google.com",
  authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  token_endpoint: "https://oauth2.googleapis.com/token",
  userinfo_endpoint: "https://openidconnect.googleapis.com/v1/userinfo",
  jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
  response_types_supported: ["code"],
};

const GITHUB_METADATA: ServerMetadata = {
  issuer: "https://github.com",
  authorization_endpoint: "https://github.com/login/oauth/authorize",
  token_endpoint: "https://github.com/login/oauth/access_token",
  response_types_supported: ["code"],
};

export interface OAuthClientConfig {
  provider: OAuthProvider;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

function configFor(cfg: OAuthClientConfig): Configuration {
  const metadata = cfg.provider === "google" ? GOOGLE_METADATA : GITHUB_METADATA;
  return new Configuration(metadata, cfg.clientId, cfg.clientSecret, ClientSecretBasic(cfg.clientSecret));
}

/** Start an authorization-code + PKCE request. Returns the URL plus the state/verifier to stash. */
export async function startAuthorization(cfg: OAuthClientConfig): Promise<{ url: string; state: string; verifier: string }> {
  const config = configFor(cfg);
  const state = randomState();
  const verifier = randomPKCECodeVerifier();
  const challenge = await calculatePKCECodeChallenge(verifier);
  const url = buildAuthorizationUrl(config, {
    redirect_uri: cfg.redirectUri,
    scope: cfg.provider === "google" ? "openid email profile" : "read:user user:email",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return { url: url.toString(), state, verifier };
}

export interface VerifiedEmail {
  providerUserId: string;
  email: string;
}

/**
 * Exchange the code (verifying state + PKCE) and return the provider-verified
 * email. Throws when the email is missing or unverified — callers must never
 * link or log in without this.
 */
export async function exchangeCode(
  cfg: OAuthClientConfig,
  callbackUrl: string,
  expectedState: string,
  verifier: string,
): Promise<VerifiedEmail> {
  const config = configFor(cfg);
  const tokens = await authorizationCodeGrant(config, new URL(callbackUrl), {
    expectedState,
    pkceCodeVerifier: verifier,
  });
  const accessToken = tokens.access_token;
  if (!accessToken) throw new Error("Provider issued no access token");
  if (cfg.provider === "google") {
    const info = (await fetchUserInfo(config, accessToken, skipSubjectCheck)) as unknown as Record<string, unknown>;
    const email = info["email"];
    const verified = info["email_verified"];
    const sub = info["sub"];
    if (typeof email !== "string" || verified !== true || typeof sub !== "string") {
      throw new Error("Google account has no verified email");
    }
    return { providerUserId: sub, email: email.toLowerCase() };
  }
  // GitHub is OAuth2 (not OIDC): verified emails come from the emails API.
  const res = await fetch("https://api.github.com/user/emails", {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`GitHub emails lookup failed (${res.status})`);
  const emails = (await res.json()) as Array<{ email?: unknown; primary?: unknown; verified?: unknown }>;
  const primary = emails.find((e) => e.primary === true && e.verified === true && typeof e.email === "string");
  if (!primary) throw new Error("GitHub account has no verified primary email");
  const userRes = await fetch("https://api.github.com/user", {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!userRes.ok) throw new Error(`GitHub user lookup failed (${userRes.status})`);
  const user = (await userRes.json()) as { id?: unknown };
  if (typeof user.id !== "number") throw new Error("GitHub user lookup returned no id");
  return { providerUserId: String(user.id), email: (primary.email as string).toLowerCase() };
}

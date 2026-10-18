// WebAuthn ceremony helpers (SimpleWebAuthn verification) with sealed,
// short-lived challenge cookies — no server-side ceremony state, so all
// store backends behave identically.

import type { Response } from "express";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { sealSecret, unsealSecret } from "./mfa.js";
import { webAuthnRp } from "./login-methods.js";

export const WEBAUTHN_CHALLENGE_COOKIE = "webauthn_challenge";
const CHALLENGE_TTL_MS = 5 * 60_000;

interface ChallengePayload {
  challenge: string;
  userId: string | null;
  purpose: "register" | "login";
  exp: number;
}

export function sealChallenge(authSecret: string, challenge: string, userId: string | null, purpose: "register" | "login"): string {
  const payload: ChallengePayload = { challenge, userId, purpose, exp: Date.now() + CHALLENGE_TTL_MS };
  return sealSecret(authSecret, JSON.stringify(payload));
}

export function unsealChallenge(authSecret: string, sealed: string | undefined, purpose: "register" | "login"): ChallengePayload | null {
  if (!sealed) return null;
  const raw = unsealSecret(authSecret, sealed);
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw) as ChallengePayload;
    if (payload.purpose !== purpose || typeof payload.challenge !== "string" || payload.exp <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function setChallengeCookie(res: Response, sealed: string): void {
  res.cookie(WEBAUTHN_CHALLENGE_COOKIE, sealed, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: CHALLENGE_TTL_MS,
    path: "/api/v1/auth/passkeys",
  });
}

export function clearChallengeCookie(res: Response): void {
  res.clearCookie(WEBAUTHN_CHALLENGE_COOKIE, { path: "/api/v1/auth/passkeys" });
}

export function toB64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

export function fromB64Url(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s, "base64url"));
}

export async function registrationOptions(userId: string, userName: string, excludeCredentialIds: string[]) {
  const { rpID, rpName } = webAuthnRp();
  return generateRegistrationOptions({
    rpName,
    rpID,
    userName,
    userID: new TextEncoder().encode(userId),
    userDisplayName: userName,
    attestationType: "none",
    excludeCredentials: excludeCredentialIds.map((id) => ({ id, transports: undefined })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
}

export async function verifyRegistration(credential: unknown, challenge: string) {
  const { rpID, origin } = webAuthnRp();
  return verifyRegistrationResponse({
    response: credential as RegistrationResponseJSON,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
  });
}

export async function authenticationOptions(allowCredentialIds: string[]) {
  const { rpID } = webAuthnRp();
  return generateAuthenticationOptions({
    rpID,
    allowCredentials:
      allowCredentialIds.length > 0 ? allowCredentialIds.map((id) => ({ id, transports: undefined })) : undefined,
    userVerification: "preferred",
  });
}

export interface StoredCredential {
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[];
}

export async function verifyAuthentication(credential: unknown, challenge: string, stored: StoredCredential) {
  const { rpID, origin } = webAuthnRp();
  return verifyAuthenticationResponse({
    response: credential as AuthenticationResponseJSON,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: stored.credentialId,
      publicKey: fromB64Url(stored.publicKey),
      counter: stored.counter,
      transports: stored.transports as AuthenticatorTransport[],
    },
    requireUserVerification: false,
  });
}

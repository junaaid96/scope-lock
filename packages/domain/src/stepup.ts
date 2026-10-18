import { randomInt } from "node:crypto";
import { DomainError } from "./errors.js";
import { sha256Hex } from "./checksum.js";

/**
 * Step-up verification for review links: an email one-time code plus a typed
 * full name, recorded with the decision. This is an identity check, not an
 * e-signature — product copy must never claim legal enforceability.
 */
export const STEP_UP_CODE_DIGITS = 6;
export const STEP_UP_TTL_MINUTES = 10;
export const STEP_UP_MAX_ATTEMPTS = 5;
export const STEP_UP_RESEND_SECONDS = 60;
export const STEP_UP_MAX_ACTIVE = 3;

export interface StepUpConfig {
  otp: boolean | null;
  typedName: boolean | null;
}

export interface StepUpChallengeState {
  expiresAt: string;
  attempts: number;
  maxAttempts: number;
  consumedAt: string | null;
}

/** Six digits, zero-padded, from a CSPRNG. Low entropy by design — the expiry, attempt cap, and binding carry the security. */
export function generateStepUpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(STEP_UP_CODE_DIGITS, "0");
}

/** Codes are stored hashed, like review tokens. Raw codes never touch the database or logs. */
export function hashStepUpCode(code: string): string {
  return sha256Hex(`step-up:${code}`);
}

/**
 * Effective step-up: the project wins when it says anything (null inherits),
 * else the org default, else off. Unknown shapes fail closed to off.
 */
export function effectiveStepUp(orgStepUp: unknown, projectStepUp: unknown): { otp: boolean; typedName: boolean } {
  const org = parseStepUp(orgStepUp);
  const project = parseStepUp(projectStepUp);
  return {
    otp: project.otp ?? org.otp ?? false,
    typedName: project.typedName ?? org.typedName ?? false,
  };
}

function parseStepUp(value: unknown): StepUpConfig {
  if (!value || typeof value !== "object") return { otp: null, typedName: null };
  const rec = value as Record<string, unknown>;
  const pick = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
  return { otp: pick(rec.otp), typedName: pick(rec.typedName) };
}

/** A challenge is good for one decision while unexpired, unconsumed, and under the attempt cap. */
export function assertChallengeUsable(ch: StepUpChallengeState, nowIso: string): void {
  if (ch.consumedAt) throw DomainError.unprocessable("This code was already used — request a fresh one");
  if (ch.expiresAt <= nowIso) throw DomainError.gone("This code has expired — request a fresh one");
  if (ch.attempts >= ch.maxAttempts) {
    throw DomainError.unprocessable("Too many wrong attempts — request a fresh code");
  }
}

/** Resend cooldown + active cap keep code delivery from becoming a spam cannon. */
export function assertMayRequest(active: Array<{ createdAt: string }>, nowMs: number): void {
  if (active.length >= STEP_UP_MAX_ACTIVE) {
    throw DomainError.unprocessable("Too many active codes — use one already sent before requesting another");
  }
  const newest = active.map((c) => Date.parse(c.createdAt)).sort((a, b) => b - a)[0];
  if (newest !== undefined && nowMs - newest < STEP_UP_RESEND_SECONDS * 1000) {
    throw DomainError.unprocessable(`Wait ${STEP_UP_RESEND_SECONDS} seconds between code requests`);
  }
}

/** The typed name is recorded verbatim with the decision — an attestation, not a match against anything. */
export function normalizeTypedName(input: unknown, required: boolean): string | null {
  const name = typeof input === "string" ? input.trim() : "";
  if (!name) {
    if (required) throw DomainError.unprocessable("Type your full name to confirm this decision");
    return null;
  }
  if (name.length < 2) throw DomainError.unprocessable("Type your full name to confirm this decision");
  return name;
}

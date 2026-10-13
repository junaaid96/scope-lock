import { randomBytes, randomUUID } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Prefixed, unguessable entity id, e.g. `org_3f9a…`. */
export function newId(prefix: string): string {
  const bytes = randomBytes(18);
  let s = "";
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${s}`;
}

/** High-entropy opaque token (sessions, invitations, review links). Never stored raw — store sha256. */
export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function newCorrelationId(): string {
  return randomUUID();
}

import { createHash, createHmac, randomBytes, timingSafeEqual, createDecipheriv, createCipheriv } from "node:crypto";

const STEP_MS = 30_000;
const DIGITS = 6;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = BASE32.indexOf(char);
    if (idx < 0) throw new Error("Invalid base32 secret");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** New TOTP secret (160-bit, base32) for authenticator enrollment. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

function hotp(secret: Buffer, counter: bigint): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(counter);
  const mac = createHmac("sha1", secret).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const code =
    (((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3]) %
    10 ** DIGITS;
  return String(code).padStart(DIGITS, "0");
}

/** Current TOTP code (used by tests/clients; the server only verifies). */
export function totpCode(secretBase32: string, atMs = Date.now()): string {
  const secret = base32Decode(secretBase32);
  return hotp(secret, BigInt(Math.floor(atMs / STEP_MS)));
}

/** Verify a 6-digit code within ±1 time step (clock skew tolerance). */
export function verifyTotp(secretBase32: string, code: string, atMs = Date.now()): boolean {
  const clean = code.replace(/[\s-]/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  let secret: Buffer;
  try {
    secret = base32Decode(secretBase32);
  } catch {
    return false;
  }
  const now = Math.floor(atMs / STEP_MS);
  for (const counter of [BigInt(now - 1), BigInt(now), BigInt(now + 1)]) {
    const expected = Buffer.from(hotp(secret, counter), "utf8");
    const actual = Buffer.from(clean, "utf8");
    if (expected.length === actual.length && timingSafeEqual(expected, actual)) return true;
  }
  return false;
}

export function otpauthUrl(secretBase32: string, email: string, issuer = "ScopeLock"): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const params = new URLSearchParams({ secret: secretBase32, issuer, algorithm: "SHA1", digits: "6", period: "30" });
  return `otpauth://totp/${label}?${params.toString()}`;
}

function mfaKey(authSecret: string): Buffer {
  return createHash("sha256").update(`scopelock-mfa-v1:${authSecret}`).digest();
}

/** AES-256-GCM seal for TOTP secrets at rest. Format: base64url(iv).base64url(ciphertext+tag). */
export function sealSecret(authSecret: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", mfaKey(authSecret), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return `${iv.toString("base64url")}.${enc.toString("base64url")}`;
}

export function unsealSecret(authSecret: string, sealed: string): string | null {
  try {
    const [ivB64, dataB64] = sealed.split(".");
    if (!ivB64 || !dataB64) return null;
    const iv = Buffer.from(ivB64, "base64url");
    const data = Buffer.from(dataB64, "base64url");
    const tag = data.subarray(data.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", mfaKey(authSecret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function hmacHex(authSecret: string, data: string): string {
  return createHmac("sha256", `scopelock-mfa-ticket-v1:${authSecret}`).update(data).digest("hex");
}

/** Short-lived stateless login ticket issued after password auth for MFA users. */
export function issueMfaTicket(authSecret: string, userId: string, ttlMs = 5 * 60_000): string {
  const exp = Date.now() + ttlMs;
  const body = `${Buffer.from(userId, "utf8").toString("base64url")}.${exp}`;
  return `v1.${body}.${hmacHex(authSecret, body)}`;
}

export function verifyMfaTicket(authSecret: string, ticket: string): string | null {
  if (!ticket.startsWith("v1.")) return null;
  const unsigned = ticket.slice(3, ticket.lastIndexOf("."));
  const sig = ticket.slice(ticket.lastIndexOf(".") + 1);
  if (!unsigned || !sig) return null;
  const expected = hmacHex(authSecret, unsigned);
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [userB64, expRaw] = unsigned.split(".");
  if (!userB64 || !expRaw) return null;
  if (Number(expRaw) <= Date.now()) return null;
  try {
    return Buffer.from(userB64, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

/** Single-use recovery codes (shown once, stored only as hashes). */
export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = randomBytes(6).toString("hex").toUpperCase();
    codes.push(`${raw.slice(0, 6)}-${raw.slice(6)}`);
  }
  return codes;
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(code.replace(/[\s-]/g, "").toUpperCase()).digest("hex");
}

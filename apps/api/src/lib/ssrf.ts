import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { DomainError } from "@scopelock/domain";

/**
 * SSRF protection for outgoing webhook delivery. Rejects credentials in the
 * URL, non-HTTP(S) schemes, and any target that is (or DNS-resolves to) a
 * non-public address: loopback, private, link-local, multicast, reserved,
 * or unspecified ranges, including IPv4-mapped IPv6.
 *
 * Plain http and loopback targets are allowed outside production so local
 * development and tests can run a receiver; production requires https and
 * public addresses.
 */

export interface SsrfPolicy {
  allowHttp: boolean;
  allowLoopback: boolean;
}

export function webhookSsrfPolicy(nodeEnv: string): SsrfPolicy {
  const prod = nodeEnv === "production";
  return { allowHttp: !prod, allowLoopback: !prod };
}

function v4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const b = Number(part);
    if (b < 0 || b > 255) return null;
    n = n * 256 + b;
  }
  return n >>> 0;
}

function inCidrV4(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw);
  const addr = v4ToInt(ip);
  const net = v4ToInt(base ?? "");
  if (addr === null || net === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (addr & mask) >>> 0 === (net & mask) >>> 0;
}

// Non-public IPv4 ranges (RFC 1918/3927/5735/5737/6598/7526...): everything
// a webhook must never reach. Loopback is listed separately so dev/test can
// allow exactly it.
const BLOCKED_V4 = [
  "0.0.0.0/8", // software scope ("this network")
  "10.0.0.0/8",
  "100.64.0.0/10", // carrier-grade NAT
  "127.0.0.0/8", // loopback (see allowLoopback)
  "169.254.0.0/16", // link-local (cloud metadata lives here)
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24", // TEST-NET-1
  "192.168.0.0/16",
  "198.18.0.0/15", // benchmarking
  "198.51.100.0/24", // TEST-NET-2
  "203.0.113.0/24", // TEST-NET-3
  "224.0.0.0/4", // multicast
  "240.0.0.0/4", // reserved + broadcast
];

function isBlockedV4(ip: string, allowLoopback: boolean): boolean {
  if (inCidrV4(ip, "127.0.0.0/8")) return !allowLoopback;
  return BLOCKED_V4.some((cidr) => cidr !== "127.0.0.0/8" && inCidrV4(ip, cidr));
}

function expandV6(ip: string): number[] | null {
  // Split `::` (at most one) then pad to 8 hextets.
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = (halves[0] ?? "").split(":").filter((h) => h !== "");
  const tail = halves.length === 2 ? (halves[1] ?? "").split(":").filter((h) => h !== "") : [];
  // Trailing embedded IPv4 (e.g. ::ffff:1.2.3.4) counts as two hextets.
  const parts = [...head, ...tail];
  const last = parts[parts.length - 1];
  let extra: number[] = [];
  if (last && last.includes(".")) {
    const n = v4ToInt(last);
    if (n === null) return null;
    parts.pop();
    extra = [(n >>> 16) & 0xffff, n & 0xffff];
  }
  const missing = 8 - parts.length - extra.length;
  if (halves.length === 1 ? missing !== 0 : missing < 0) return null;
  const out: number[] = [];
  for (const h of head) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(h)) return null;
    out.push(parseInt(h, 16));
  }
  for (let i = 0; i < (halves.length === 2 ? missing : 0); i++) out.push(0);
  for (const h of tail) {
    if (h.includes(".")) continue; // consumed as embedded IPv4 above
    if (!/^[0-9a-fA-F]{1,4}$/.test(h)) return null;
    out.push(parseInt(h, 16));
  }
  out.push(...extra);
  return out.length === 8 ? out : null;
}

function isBlockedV6(ip: string, allowLoopback: boolean): boolean {
  const h = expandV6(ip.toLowerCase());
  if (!h || h.length !== 8) return true; // unparseable: fail closed
  const h0 = h[0] as number;
  const h1 = h[1] as number;
  const h6 = h[6] as number;
  const h7 = h[7] as number;
  if (h.every((x) => x === 0)) return true; // ::
  if (h.slice(0, 7).every((x) => x === 0) && h7 === 1) return !allowLoopback; // ::1
  if ((h0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((h0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((h0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (h0 === 0x2001 && h1 === 0xdb8) return true; // 2001:db8::/32 documentation
  if (h0 === 0x64 && h1 === 0xff9b && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0) return true; // 64:ff9b::/96 translation
  // IPv4-mapped (::ffff:a.b.c.d): judge the embedded IPv4 address.
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) {
    return isBlockedV4(`${(h6 >>> 8) & 0xff}.${h6 & 0xff}.${(h7 >>> 8) & 0xff}.${h7 & 0xff}`, allowLoopback);
  }
  return false;
}

/** True when a literal IP may receive webhook traffic under the policy. */
export function isAllowedIp(ip: string, policy: SsrfPolicy): boolean {
  const family = isIP(ip);
  if (family === 4) return !isBlockedV4(ip, policy.allowLoopback);
  if (family === 6) return !isBlockedV6(ip, policy.allowLoopback);
  return false;
}

/**
 * Validate a webhook target URL: scheme, no credentials, literal-IP check,
 * then DNS resolution with every returned address checked. Returns the
 * parsed URL; throws unprocessable on any violation.
 */
export async function assertSafeWebhookUrl(rawUrl: string, policy: SsrfPolicy): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw DomainError.unprocessable("Webhook URL is not a valid URL");
  }
  if (url.protocol !== "https:" && !(policy.allowHttp && url.protocol === "http:")) {
    throw DomainError.unprocessable("Webhook URL must use https");
  }
  if (url.username !== "" || url.password !== "") {
    throw DomainError.unprocessable("Webhook URL must not embed credentials");
  }
  if (url.hostname === "") throw DomainError.unprocessable("Webhook URL must have a host");
  if (isIP(url.hostname) !== 0) {
    if (!isAllowedIp(url.hostname, policy)) {
      throw DomainError.unprocessable("Webhook URL targets a disallowed address");
    }
    return url;
  }
  let records: Array<{ address: string }>;
  try {
    records = await lookup(url.hostname, { all: true });
  } catch {
    throw DomainError.unprocessable("Webhook URL host does not resolve");
  }
  if (records.length === 0) throw DomainError.unprocessable("Webhook URL host does not resolve");
  for (const record of records) {
    if (!isAllowedIp(record.address, policy)) {
      throw DomainError.unprocessable("Webhook URL resolves to a disallowed address");
    }
  }
  return url;
}

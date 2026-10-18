/**
 * Inbound-email helpers: quoted-reply/signature stripping, loop detection,
 * and address parsing. Pure functions; the webhook module wires them up.
 */

/** Extract the addr-spec from "Name <addr@host>" or a bare address. */
export function parseEmailAddress(raw: string): string | null {
  const trimmed = raw.trim();
  const bracket = trimmed.match(/<([^<>@\s]+@[^<>@\s]+)>/);
  const candidate = bracket?.[1] ?? trimmed;
  if (!candidate || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(candidate)) return null;
  return candidate.toLowerCase();
}

/** Local part of an addr-spec (after +tag removal), lowercased. */
export function mailboxLocalPart(address: string): string {
  return address.split("@")[0]?.split("+")[0]?.toLowerCase() ?? "";
}

const QUOTE_HEADERS = [
  /^\s*on\s.+wrote:\s*$/i,
  /^\s*-{2,}\s*original message\s*-{2,}\s*$/i,
  /^\s*_{2,}\s*$/,
  /^\s*from:.*\nsent:.*\nto:.*$/i,
];

const SIGNATURE_DELIMITER = /^\s*--\s*$/;

/**
 * Strip quoted history and signatures from a plaintext body. Keeps the
 * author's top post; returns "" when nothing usable remains.
 */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const kept: string[] = [];
  for (const line of lines) {
    if (SIGNATURE_DELIMITER.test(line)) break;
    if (QUOTE_HEADERS.some((re) => re.test(line))) break;
    if (/^\s*>/.test(line)) continue;
    kept.push(line);
  }
  // Drop leading/trailing blank lines left behind by the cuts above.
  while (kept.length > 0 && kept[0]?.trim() === "") kept.shift();
  while (kept.length > 0 && kept[kept.length - 1]?.trim() === "") kept.pop();
  return kept.join("\n").trim();
}

export interface LoopHeaders {
  autoSubmitted?: string | null;
  precedence?: string | null;
  xAutoResponseSuppress?: string | null;
  from?: string | null;
}

/**
 * Detect auto-replies and mail loops. Our own address + provider loop
 * headers + classic auto-subject markers all count as machine mail.
 */
export function isAutoReply(headers: LoopHeaders, ourAddresses: string[]): boolean {
  const from = headers.from ? parseEmailAddress(headers.from) : null;
  if (from && ourAddresses.map((a) => a.toLowerCase()).includes(from)) return true;
  const auto = (headers.autoSubmitted ?? "").toLowerCase().trim();
  if (auto !== "" && auto !== "no") return true;
  const precedence = (headers.precedence ?? "").toLowerCase();
  if (["bulk", "junk", "list"].includes(precedence)) return true;
  // Any X-Auto-Response-Suppress value marks machine/solicited mail. This is
  // deliberately conservative: a dropped loop beats an auto-reply storm.
  if ((headers.xAutoResponseSuppress ?? "").trim() !== "") return true;
  return false;
}

const AUTO_SUBJECTS = [/^\s*(out of office|ooo|auto:?|automatic reply|vacation|delivery status|undeliverable|mail delivery failed)\b/i];

/** Subject-line backstop for auto-replies whose headers were stripped. */
export function looksLikeAutoSubject(subject: string): boolean {
  return AUTO_SUBJECTS.some((re) => re.test(subject));
}

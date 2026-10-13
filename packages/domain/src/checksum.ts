import { createHash } from "node:crypto";

/** Deterministic JSON canonicalization: sorted keys, stable nesting, no whitespace. */
export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => canonicalize(v)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
}

/** sha256 checksum of the canonical form — binds review packages and diffs to exact content. */
export function checksumOf(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

export function sha256Hex(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

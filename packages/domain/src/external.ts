// External work references: CHG-### / REQ-### mentions parsed out of provider
// payloads (PR titles, bodies, branches, commit messages). Pure by design —
// providers normalize their payloads to plain strings before calling in.

/** Matches scoped identifiers as stored (`CHG-001`, `REQ-042`, …). */
const REF_PATTERN = /\b(CHG|REQ)-(\d{3,})\b/g;

export type ExternalRefKind = "CHANGE" | "REQUIREMENT";

export interface ExternalRef {
  kind: ExternalRefKind;
  /** Canonical identifier, e.g. `CHG-001`. */
  ref: string;
}

/**
 * Extract scoped identifiers from free text. Order-preserving, deduped,
 * case-sensitive (identifiers are always stored uppercase).
 */
export function parseExternalRefs(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  REF_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = REF_PATTERN.exec(text)) !== null) {
    const ref = `${match[1]}-${match[2]}`;
    if (!seen.has(ref)) {
      seen.add(ref);
      out.push(ref);
    }
  }
  return out;
}

/** Split a canonical ref into its kind. Returns null for malformed input. */
export function splitExternalRef(ref: string): ExternalRef | null {
  const match = /^(CHG|REQ)-(\d{3,})$/.exec(ref);
  if (!match) return null;
  return { kind: match[1] === "CHG" ? "CHANGE" : "REQUIREMENT", ref };
}

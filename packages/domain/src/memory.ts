// Decision memory: pure lexical ranking and excerpting over past decisions.
// Excerpts are verbatim slices of stored text — memory results never contain
// generated conclusions.

const TOKEN_PATTERN = /[a-z0-9]+/g;

/** Lowercase alphanumeric tokens; short noise and duplicates dropped. */
export function tokenizeQuery(query: string): string[] {
  const tokens = query.toLowerCase().match(TOKEN_PATTERN) ?? [];
  return [...new Set(tokens.filter((t) => t.length >= 2))].slice(0, 20);
}

export interface MemoryDocument {
  title: string;
  text: string;
}

/**
 * Lexical relevance in [0, 1+]: per-term title matches weigh 2, text matches
 * 1, normalized by term count; matching every term adds a 0.5 bonus.
 * Returns 0 when nothing matches.
 */
export function scoreLexical(query: string, doc: MemoryDocument): number {
  const terms = tokenizeQuery(query);
  if (terms.length === 0) return 0;
  const title = doc.title.toLowerCase();
  const text = doc.text.toLowerCase();
  let matched = 0;
  let points = 0;
  for (const term of terms) {
    const inTitle = title.includes(term);
    const inText = !inTitle && text.includes(term);
    if (inTitle || inText) {
      matched += 1;
      points += inTitle ? 2 : 1;
    }
  }
  if (matched === 0) return 0;
  return points / terms.length + (matched === terms.length ? 0.5 : 0);
}

/**
 * Verbatim excerpt: a window around the first query-term hit, ellipsized.
 * Falls back to the leading slice when no term hits (semantic ranking).
 * Always a substring of the source (modulo added ellipses).
 */
export function buildExcerpt(text: string, query: string, maxChars = 200): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;
  const lower = clean.toLowerCase();
  let hit = -1;
  for (const term of tokenizeQuery(query)) {
    const at = lower.indexOf(term);
    if (at >= 0 && (hit < 0 || at < hit)) hit = at;
  }
  if (hit < 0) return `${clean.slice(0, maxChars).trimEnd()}…`;
  const start = Math.max(0, hit - Math.floor((maxChars - 20) / 2));
  const end = Math.min(clean.length, start + maxChars);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < clean.length ? "…" : "";
  return `${prefix}${clean.slice(start, end).trim()}${suffix}`;
}

/** Cosine similarity for unit-scale embeddings; 0 when degenerate. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

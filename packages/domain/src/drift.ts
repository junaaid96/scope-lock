// Deterministic (rules-based) scope-drift detector — the P0 detector.
// AI suggestions (P1) must cite these same requirement ids; invented ids are rejected.

export interface DriftCandidate {
  requirementId: string;
  stableKey: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
}

export interface DriftSuggestion {
  requirementId: string;
  stableKey: string;
  /** 0..1 token-overlap score. */
  score: number;
  risk: "HIGH" | "MEDIUM" | "LOW";
  matchedTerms: string[];
  excerpt: string;
  explanation: string;
}

const STOPWORDS = new Set(
  "a,an,the,and,or,but,if,then,else,for,to,of,in,on,at,by,with,from,as,is,are,was,were,be,been,being,it,its,this,that,these,those,i,you,he,she,we,they,them,his,her,our,your,their,not,no,do,does,did,can,could,should,would,will,just,so,very,more,most,also,into,over,under,please,need,needs,want,wants,like,add,new,get,got,have,has,had,make,made,let,us,use,using,used,via,per".split(
    ",",
  ),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function excerptAround(text: string, term: string, radius = 48): string {
  const idx = text.toLowerCase().indexOf(term.toLowerCase());
  if (idx < 0) return text.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + term.length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

export function detectDrift(
  requestText: string,
  candidates: DriftCandidate[],
  options?: { minScore?: number; maxResults?: number },
): DriftSuggestion[] {
  const minScore = options?.minScore ?? 0.08;
  const maxResults = options?.maxResults ?? 5;
  const requestTokens = new Set(tokenize(requestText));
  if (requestTokens.size === 0) return [];

  const suggestions: DriftSuggestion[] = [];
  for (const c of candidates) {
    const haystack = `${c.title}\n${c.description}\n${c.acceptanceCriteria.join("\n")}`;
    const candidateTokens = new Set(tokenize(haystack));
    if (candidateTokens.size === 0) continue;
    const matched = [...requestTokens].filter((t) => candidateTokens.has(t));
    if (matched.length === 0) continue;
    const union = new Set([...requestTokens, ...candidateTokens]);
    const jaccard = matched.length / union.size;
    // Boost when the requirement title itself shares terms (stronger signal).
    const titleTokens = new Set(tokenize(c.title));
    const titleHits = matched.filter((t) => titleTokens.has(t)).length;
    const score = Math.min(1, jaccard * 2 + (titleHits > 0 ? 0.15 + 0.1 * Math.min(titleHits, 3) : 0));
    if (score < minScore) continue;
    const risk = score >= 0.45 ? "HIGH" : score >= 0.2 ? "MEDIUM" : "LOW";
    const firstTerm = matched[0] ?? "";
    suggestions.push({
      requirementId: c.requirementId,
      stableKey: c.stableKey,
      score: Math.round(score * 1000) / 1000,
      risk,
      matchedTerms: matched.slice(0, 8),
      excerpt: excerptAround(haystack, firstTerm),
      explanation:
        risk === "HIGH"
          ? `Request shares distinctive terms (${matched.slice(0, 4).join(", ")}) with ${c.stableKey}; likely overlaps approved scope.`
          : `Request shares terms (${matched.slice(0, 4).join(", ")}) with ${c.stableKey}; review whether it is already covered.`,
    });
  }
  return suggestions.sort((a, b) => b.score - a.score).slice(0, maxResults);
}

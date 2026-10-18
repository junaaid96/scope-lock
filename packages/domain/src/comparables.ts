// Price suggestions: rank comparable approved changes with deterministic
// lexical scoring, and compute estimate-vs-actual deltas. Suggestions are
// the comparables themselves with their real approved prices — there is no
// single generated number (no black box).

import { scoreLexical, tokenizeQuery } from "./memory.js";

export interface ComparableCandidate {
  changeId: string;
  title: string;
  description: string;
}

export interface RankedComparable {
  changeId: string;
  score: number;
  /** Query terms that hit this candidate (transparency, not a conclusion). */
  sharedTerms: string[];
}

/**
 * Rank candidates by lexical overlap with the target's title + description.
 * Zero-score candidates are dropped; ties break by changeId for stability.
 * Pure and deterministic: the same inputs always rank the same way.
 */
export function rankComparables(
  targetTitle: string,
  targetDescription: string,
  candidates: ComparableCandidate[],
  limit: number,
): RankedComparable[] {
  // Two-letter tokens ("on", "to") substring-match almost everything, so
  // comparables rank on significant terms only. The shared primitive keeps
  // its own floor; this filter is the suggestion feature's concern.
  const terms = tokenizeQuery(`${targetTitle}\n${targetDescription}`).filter((t) => t.length >= 3);
  if (terms.length === 0) return [];
  const query = terms.join(" ");
  const ranked: RankedComparable[] = [];
  for (const c of candidates) {
    const score = scoreLexical(query, { title: c.title, text: c.description });
    if (score <= 0) continue;
    const hay = `${c.title}\n${c.description}`.toLowerCase();
    ranked.push({ changeId: c.changeId, score, sharedTerms: terms.filter((t) => hay.includes(t)) });
  }
  ranked.sort((a, b) => b.score - a.score || (a.changeId < b.changeId ? -1 : a.changeId > b.changeId ? 1 : 0));
  return ranked.slice(0, Math.max(0, limit));
}

export interface EstimateActualDelta {
  estimateMinor: number | null;
  actualMinor: number | null;
  /** actual - estimate in minor units; null unless both sides exist. */
  varianceMinor: number | null;
  /** Rounded percent over/under estimate; null unless both exist and estimate != 0. */
  variancePct: number | null;
  estimateDays: number | null;
  actualDays: number | null;
  daysVariance: number | null;
}

/** Estimate-vs-actual variance. Null-safe: missing actuals yield null deltas, never zeros. */
export function actualsDelta(
  estimateMinor: number | null,
  actualMinor: number | null,
  estimateDays: number | null,
  actualDays: number | null,
): EstimateActualDelta {
  const varianceMinor = estimateMinor !== null && actualMinor !== null ? actualMinor - estimateMinor : null;
  const variancePct =
    varianceMinor !== null && estimateMinor !== null && estimateMinor !== 0
      ? Math.round((varianceMinor / estimateMinor) * 1000) / 10
      : null;
  return {
    estimateMinor,
    actualMinor,
    varianceMinor,
    variancePct,
    estimateDays,
    actualDays,
    daysVariance: estimateDays !== null && actualDays !== null ? actualDays - estimateDays : null,
  };
}

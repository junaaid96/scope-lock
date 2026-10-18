import { DomainError } from "./errors.js";

/** Proposal options: 2-4 priced alternatives per review package, or none. */
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;

export interface OptionCandidate {
  id: string;
  label: string;
  effortDays: number | null;
  priceMinor: number | null;
  currency: string | null;
}

/**
 * Options are all-or-nothing at send time: absent, or 2-4 of them, each
 * fully priced so the client's pick is immediately actionable. Returns the
 * price that sets the policy tier (highest alternative = most cautious).
 */
export function assertSendableOptions(options: OptionCandidate[]): number | null {
  if (options.length === 0) return null;
  if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
    throw DomainError.unprocessable(`Proposal options come in ${MIN_OPTIONS}-${MAX_OPTIONS}, or none at all`, {
      count: options.length,
    });
  }
  const seen = new Set<string>();
  for (const o of options) {
    const label = o.label.trim().toLowerCase();
    if (!label) throw DomainError.unprocessable("Every proposal option needs a label");
    if (seen.has(label)) throw DomainError.unprocessable(`Duplicate proposal option: "${o.label.trim()}"`);
    seen.add(label);
    if (o.priceMinor === null || !o.currency) {
      throw DomainError.unprocessable(`Option "${o.label.trim()}" needs a price and currency (use 0 for no charge)`);
    }
    if (o.effortDays === null) {
      throw DomainError.unprocessable(`Option "${o.label.trim()}" needs an effort estimate`);
    }
  }
  return Math.max(...options.map((o) => o.priceMinor as number));
}

/** The client's pick must name exactly one snapshotted option — no invented ids. */
export function assertValidChoice<T extends { optionId: string }>(options: T[], optionId: string): T {
  const found = options.find((o) => o.optionId === optionId);
  if (!found) throw DomainError.unprocessable("That option is not part of this review package", { optionId });
  return found;
}

/**
 * Multi-approver agreement: every APPROVED vote must name the same option,
 * so the terminal outcome carries a single unambiguous pick. Enforced per
 * vote (409 on mismatch) rather than at aggregation, so the second voter
 * learns immediately instead of after everyone has voted.
 */
export function assertOptionAgreement(priorOptionIds: Array<string | null>, nextOptionId: string): void {
  const distinct = [...new Set(priorOptionIds.filter((id): id is string => id !== null))];
  if (distinct.length > 0 && !distinct.includes(nextOptionId)) {
    throw DomainError.conflict("An earlier approver already picked a different option — all approvals must agree on one", {
      picked: distinct,
    });
  }
}

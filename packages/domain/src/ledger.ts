// Contract value ledger: derived, never hand-edited.
// baseline budget + approved change deltas = current value.
//
// ABSORBED WORK (precise definition): approved-or-implemented changes whose
// approved impact price is explicitly zero — work the agency decided to do
// without charging. Measured in effort days (when estimated) plus item count.
// Rejected, withdrawn, unapproved, and still-estimating work is NEVER
// absorbed: absorption is a decided commercial outcome, not a forecast.
// Zero is currency-free, so absorbed items ignore currency mismatch.

import { assertCurrency, assertMinorUnits } from "./money.js";

export interface LedgerChangeInput {
  changeId: string;
  number: string;
  title: string;
  status: string;
  priceMinor: number | null;
  currency: string | null;
  effortDays: number | null;
  decidedAt: string | null;
  amendmentVersionId: string | null;
}

export interface LedgerVersionInput {
  scopeVersionId: string;
  sequence: number;
  status: string;
  title: string | null;
}

export interface LedgerDelta {
  changeId: string;
  number: string;
  title: string;
  priceMinor: number;
  decidedAt: string;
  amendmentVersionId: string | null;
}

export interface LedgerPending {
  changeId: string;
  number: string;
  title: string;
  priceMinor: number;
  status: string;
}

export interface LedgerAbsorbed {
  changeId: string;
  number: string;
  title: string;
  effortDays: number | null;
  decidedAt: string;
}

export type LedgerExclusionReason = "CURRENCY_MISMATCH" | "UNPRICED" | "NOT_APPROVED";

export interface LedgerExclusion {
  changeId: string;
  number: string;
  reason: LedgerExclusionReason;
  detail: string;
}

export interface VersionValue {
  scopeVersionId: string;
  sequence: number;
  status: string;
  title: string | null;
  deltaMinor: number;
  changeNumbers: string[];
}

export interface ContractLedger {
  currency: string;
  baselineMinor: number | null;
  approvedDeltaMinor: number;
  currentMinor: number | null;
  pendingExposureMinor: number;
  unattributedMinor: number;
  unattributedNumbers: string[];
  absorbedEffortDays: number;
  absorbedCount: number;
  deltas: LedgerDelta[];
  pending: LedgerPending[];
  absorbed: LedgerAbsorbed[];
  excluded: LedgerExclusion[];
  byVersion: VersionValue[];
}

const DECIDED = new Set(["APPROVED", "IMPLEMENTED"]);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeContractLedger(args: {
  currency: string;
  baselineMinor: number | null;
  changes: LedgerChangeInput[];
  versions: LedgerVersionInput[];
}): ContractLedger {
  assertCurrency(args.currency);
  if (args.baselineMinor !== null) assertMinorUnits(args.baselineMinor, "baseline");

  const deltas: LedgerDelta[] = [];
  const pending: LedgerPending[] = [];
  const absorbed: LedgerAbsorbed[] = [];
  const excluded: LedgerExclusion[] = [];

  for (const c of args.changes) {
    if (c.status === "PENDING_APPROVAL") {
      if (c.priceMinor === null || c.currency === null) {
        excluded.push({ changeId: c.changeId, number: c.number, reason: "UNPRICED", detail: "Awaiting decision without a recorded price." });
        continue;
      }
      assertMinorUnits(c.priceMinor, "price");
      if (c.currency !== args.currency) {
        excluded.push({
          changeId: c.changeId,
          number: c.number,
          reason: "CURRENCY_MISMATCH",
          detail: `Impact is ${c.currency}, project is ${args.currency}; never converted silently.`,
        });
        continue;
      }
      pending.push({ changeId: c.changeId, number: c.number, title: c.title, priceMinor: c.priceMinor, status: c.status });
      continue;
    }
    if (!DECIDED.has(c.status)) continue;
    // Only approved changes move value: an implementation without a recorded
    // decision is excluded, never silently counted.
    if (!c.decidedAt) {
      excluded.push({ changeId: c.changeId, number: c.number, reason: "NOT_APPROVED", detail: "Implemented without a recorded approval decision." });
      continue;
    }
    if (c.priceMinor === null || c.currency === null) {
      excluded.push({ changeId: c.changeId, number: c.number, reason: "UNPRICED", detail: "Decided without a recorded price." });
      continue;
    }
    assertMinorUnits(c.priceMinor, "price");
    if (c.priceMinor === 0) {
      absorbed.push({ changeId: c.changeId, number: c.number, title: c.title, effortDays: c.effortDays, decidedAt: c.decidedAt });
      continue;
    }
    if (c.currency !== args.currency) {
      excluded.push({
        changeId: c.changeId,
        number: c.number,
        reason: "CURRENCY_MISMATCH",
        detail: `Impact is ${c.currency}, project is ${args.currency}; never converted silently.`,
      });
      continue;
    }
    deltas.push({
      changeId: c.changeId,
      number: c.number,
      title: c.title,
      priceMinor: c.priceMinor,
      decidedAt: c.decidedAt,
      amendmentVersionId: c.amendmentVersionId,
    });
  }

  const approvedDeltaMinor = deltas.reduce((sum, d) => sum + d.priceMinor, 0);
  const pendingExposureMinor = pending.reduce((sum, p) => sum + p.priceMinor, 0);
  const absorbedEffortDays = round2(absorbed.reduce((sum, a) => sum + (a.effortDays ?? 0), 0));

  // Value by scope version: only published history counts as contract value.
  // Approved deltas whose amendment is still a draft (or never linked) sit in
  // the unattributed bucket until their amendment publishes.
  const published = args.versions
    .filter((v) => v.status === "PUBLISHED" || v.status === "SUPERSEDED")
    .sort((a, b) => a.sequence - b.sequence);
  const byId = new Map(published.map((v) => [v.scopeVersionId, v]));
  const byVersion: VersionValue[] = published.map((v) => ({
    scopeVersionId: v.scopeVersionId,
    sequence: v.sequence,
    status: v.status,
    title: v.title,
    deltaMinor: 0,
    changeNumbers: [],
  }));
  const unattributedNumbers: string[] = [];
  let unattributedMinor = 0;
  for (const d of deltas) {
    const slot = d.amendmentVersionId ? byVersion.find((v) => v.scopeVersionId === d.amendmentVersionId) : undefined;
    if (slot && byId.has(slot.scopeVersionId)) {
      slot.deltaMinor += d.priceMinor;
      slot.changeNumbers.push(d.number);
    } else {
      unattributedMinor += d.priceMinor;
      unattributedNumbers.push(d.number);
    }
  }

  return {
    currency: args.currency,
    baselineMinor: args.baselineMinor,
    approvedDeltaMinor,
    currentMinor: args.baselineMinor === null ? null : args.baselineMinor + approvedDeltaMinor,
    pendingExposureMinor,
    unattributedMinor,
    unattributedNumbers,
    absorbedEffortDays,
    absorbedCount: absorbed.length,
    deltas,
    pending,
    absorbed,
    excluded,
    byVersion,
  };
}

export interface ProjectLedgerSummary {
  projectId: string;
  name: string;
  currency: string;
  baselineMinor: number | null;
  currentMinor: number | null;
  pendingExposureMinor: number;
  absorbedCount: number;
}

export interface CurrencyTotal {
  currency: string;
  projectCount: number;
  baselineMinor: number;
  currentMinor: number;
  pendingExposureMinor: number;
}

export interface OrgContractRollup {
  projects: ProjectLedgerSummary[];
  /** One total per currency. Amounts are never converted; projects without a
   * baseline are counted but contribute no baseline/current money. */
  totalsByCurrency: CurrencyTotal[];
}

export function computeOrgRollup(projects: ProjectLedgerSummary[]): OrgContractRollup {
  const totals = new Map<string, CurrencyTotal>();
  for (const p of projects) {
    assertCurrency(p.currency);
    let slot = totals.get(p.currency);
    if (!slot) {
      slot = { currency: p.currency, projectCount: 0, baselineMinor: 0, currentMinor: 0, pendingExposureMinor: 0 };
      totals.set(p.currency, slot);
    }
    slot.projectCount += 1;
    if (p.baselineMinor !== null) assertMinorUnits(p.baselineMinor, "baseline");
    if (p.currentMinor !== null) assertMinorUnits(p.currentMinor, "current");
    assertMinorUnits(p.pendingExposureMinor, "pending exposure");
    if (p.baselineMinor !== null) slot.baselineMinor += p.baselineMinor;
    if (p.currentMinor !== null) slot.currentMinor += p.currentMinor;
    slot.pendingExposureMinor += p.pendingExposureMinor;
  }
  return {
    projects,
    totalsByCurrency: [...totals.values()].sort((a, b) => (a.currency < b.currency ? -1 : 1)),
  };
}

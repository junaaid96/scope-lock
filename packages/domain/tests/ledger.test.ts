import { describe, expect, it } from "vitest";
import { computeContractLedger, computeOrgRollup, type LedgerChangeInput } from "../src/ledger.js";

function change(over: Partial<LedgerChangeInput> & { number: string }): LedgerChangeInput {
  return {
    changeId: `ch_${over.number}`,
    title: `Change ${over.number}`,
    status: "APPROVED",
    priceMinor: 10000,
    currency: "USD",
    effortDays: 2,
    decidedAt: "2026-10-10T00:00:00.000Z",
    amendmentVersionId: null,
    ...over,
  };
}

const V1 = { scopeVersionId: "v1", sequence: 1, status: "SUPERSEDED", title: "Baseline" };
const V2 = { scopeVersionId: "v2", sequence: 2, status: "PUBLISHED", title: "Amendment" };

describe("computeContractLedger", () => {
  it("derives current value as baseline plus approved deltas", () => {
    const ledger = computeContractLedger({
      currency: "USD",
      baselineMinor: 100000,
      changes: [change({ number: "CHG-001", priceMinor: 25000 }), change({ number: "CHG-002", priceMinor: 5000 })],
      versions: [V1],
    });
    expect(ledger.approvedDeltaMinor).toBe(30000);
    expect(ledger.currentMinor).toBe(130000);
    expect(ledger.deltas.map((d) => d.number)).toEqual(["CHG-001", "CHG-002"]);
  });

  it("leaves current value unknown without a baseline", () => {
    const ledger = computeContractLedger({
      currency: "USD",
      baselineMinor: null,
      changes: [change({ number: "CHG-001" })],
      versions: [],
    });
    expect(ledger.currentMinor).toBeNull();
    expect(ledger.approvedDeltaMinor).toBe(10000);
  });

  it("counts pending priced changes as exposure, never as value", () => {
    const ledger = computeContractLedger({
      currency: "USD",
      baselineMinor: 100000,
      changes: [
        change({ number: "CHG-001", status: "PENDING_APPROVAL", priceMinor: 40000, decidedAt: null }),
        change({ number: "CHG-002", status: "ESTIMATING", priceMinor: 99999, decidedAt: null }),
      ],
      versions: [],
    });
    expect(ledger.pendingExposureMinor).toBe(40000);
    expect(ledger.approvedDeltaMinor).toBe(0);
    expect(ledger.currentMinor).toBe(100000);
    expect(ledger.pending.map((p) => p.number)).toEqual(["CHG-001"]);
  });

  it("defines absorbed work as decided zero-price changes only", () => {
    const ledger = computeContractLedger({
      currency: "USD",
      baselineMinor: 0,
      changes: [
        change({ number: "CHG-001", priceMinor: 0, effortDays: 3, currency: "EUR" }), // zero is currency-free
        change({ number: "CHG-002", priceMinor: 0, effortDays: null, status: "IMPLEMENTED" }),
        change({ number: "CHG-003", priceMinor: 0, status: "REJECTED" }), // not decided-for → ignored
        change({ number: "CHG-004", priceMinor: 0, status: "IMPLEMENTED", decidedAt: null }), // unapproved → excluded
      ],
      versions: [],
    });
    expect(ledger.absorbedCount).toBe(2);
    expect(ledger.absorbedEffortDays).toBe(3);
    expect(ledger.approvedDeltaMinor).toBe(0);
    expect(ledger.excluded.map((e) => e.number)).toEqual(["CHG-004"]);
    expect(ledger.excluded[0]?.reason).toBe("NOT_APPROVED");
  });

  it("excludes currency-mismatched and unpriced decisions without converting", () => {
    const ledger = computeContractLedger({
      currency: "USD",
      baselineMinor: 100000,
      changes: [
        change({ number: "CHG-001", priceMinor: 50000, currency: "EUR" }),
        change({ number: "CHG-002", priceMinor: null, currency: null }),
        change({ number: "CHG-003", status: "PENDING_APPROVAL", priceMinor: 1000, currency: "EUR", decidedAt: null }),
      ],
      versions: [],
    });
    expect(ledger.approvedDeltaMinor).toBe(0);
    expect(ledger.pendingExposureMinor).toBe(0);
    expect(ledger.excluded.map((e) => [e.number, e.reason])).toEqual([
      ["CHG-001", "CURRENCY_MISMATCH"],
      ["CHG-002", "UNPRICED"],
      ["CHG-003", "CURRENCY_MISMATCH"],
    ]);
  });

  it("excludes implementations without a recorded decision", () => {
    const ledger = computeContractLedger({
      currency: "USD",
      baselineMinor: 100000,
      changes: [change({ number: "CHG-001", status: "IMPLEMENTED", priceMinor: 50000, decidedAt: null })],
      versions: [],
    });
    expect(ledger.approvedDeltaMinor).toBe(0);
    expect(ledger.excluded[0]).toMatchObject({ number: "CHG-001", reason: "NOT_APPROVED" });
  });

  it("attributes value to published versions and buckets the rest", () => {
    const ledger = computeContractLedger({
      currency: "USD",
      baselineMinor: 100000,
      changes: [
        change({ number: "CHG-001", priceMinor: 25000, amendmentVersionId: "v2" }),
        change({ number: "CHG-002", priceMinor: 7000, amendmentVersionId: null }),
        change({ number: "CHG-003", priceMinor: 3000, amendmentVersionId: "draft", status: "IMPLEMENTED" }),
      ],
      versions: [V1, V2, { scopeVersionId: "draft", sequence: 3, status: "DRAFT", title: null }],
    });
    expect(ledger.byVersion.map((v) => [v.sequence, v.deltaMinor, v.changeNumbers])).toEqual([
      [1, 0, []],
      [2, 25000, ["CHG-001"]],
    ]);
    expect(ledger.unattributedMinor).toBe(10000);
    expect(ledger.unattributedNumbers).toEqual(["CHG-002", "CHG-003"]);
  });
});

describe("computeOrgRollup", () => {
  it("totals per currency without converting and skips missing baselines", () => {
    const rollup = computeOrgRollup([
      { projectId: "p1", name: "A", currency: "USD", baselineMinor: 100000, currentMinor: 130000, pendingExposureMinor: 5000, absorbedCount: 1 },
      { projectId: "p2", name: "B", currency: "USD", baselineMinor: null, currentMinor: null, pendingExposureMinor: 2000, absorbedCount: 0 },
      { projectId: "p3", name: "C", currency: "BDT", baselineMinor: 50000, currentMinor: 50000, pendingExposureMinor: 0, absorbedCount: 0 },
    ]);
    expect(rollup.totalsByCurrency).toEqual([
      { currency: "BDT", projectCount: 1, baselineMinor: 50000, currentMinor: 50000, pendingExposureMinor: 0 },
      { currency: "USD", projectCount: 2, baselineMinor: 100000, currentMinor: 130000, pendingExposureMinor: 7000 },
    ]);
  });
});

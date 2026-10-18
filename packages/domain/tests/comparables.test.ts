import { describe, expect, it } from "vitest";
import { actualsDelta, rankComparables } from "../src/comparables.js";

describe("rankComparables", () => {
  const candidates = [
    { changeId: "chg_b", title: "Mobile dashboard widgets", description: "charts inside sales app" },
    { changeId: "chg_a", title: "Salesmen mobile dashboard", description: "route orders and collections" },
    { changeId: "chg_c", title: "Payroll export", description: "monthly csv accountants" },
  ];

  it("ranks title overlap first and drops zero-score candidates", () => {
    const ranked = rankComparables("Salesmen mobile dashboard", "phone-first dashboard", candidates, 10);
    expect(ranked.map((r) => r.changeId)).toEqual(["chg_a", "chg_b"]);
    expect(ranked[0]?.sharedTerms).toContain("dashboard");
    expect(ranked.every((r) => r.score > 0)).toBe(true);
  });

  it("is deterministic with stable tie-breaking and honors the limit", () => {
    const twins = [
      { changeId: "chg_2", title: "Dashboard", description: "" },
      { changeId: "chg_1", title: "Dashboard", description: "" },
    ];
    const once = rankComparables("Dashboard", "", twins, 10);
    const twice = rankComparables("Dashboard", "", [...twins].reverse(), 10);
    expect(once.map((r) => r.changeId)).toEqual(["chg_1", "chg_2"]);
    expect(twice.map((r) => r.changeId)).toEqual(["chg_1", "chg_2"]);
    expect(rankComparables("Dashboard", "", twins, 1)).toHaveLength(1);
    expect(rankComparables("!!!", "", twins, 10)).toEqual([]);
  });
});

describe("actualsDelta", () => {
  it("computes money and effort variance", () => {
    expect(actualsDelta(100000, 120000, 8, 10)).toEqual({
      estimateMinor: 100000,
      actualMinor: 120000,
      varianceMinor: 20000,
      variancePct: 20,
      estimateDays: 8,
      actualDays: 10,
      daysVariance: 2,
    });
  });

  it("stays null-safe instead of inventing zeros", () => {
    expect(actualsDelta(100000, null, 8, null)).toMatchObject({ varianceMinor: null, variancePct: null, daysVariance: null });
    expect(actualsDelta(null, 50000, null, 4)).toMatchObject({ varianceMinor: null, variancePct: null, daysVariance: null });
    expect(actualsDelta(0, 50000, 0, 4).variancePct).toBe(null);
    expect(actualsDelta(0, 50000, 0, 4).varianceMinor).toBe(50000);
  });
});

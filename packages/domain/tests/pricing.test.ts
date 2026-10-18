import { describe, expect, it } from "vitest";
import { computeImpactPrice } from "../src/pricing.js";

const RATES = [
  { role: "Senior Engineer", hourlyRateMinor: 8000 },
  { role: "Designer", hourlyRateMinor: 5000 },
];

describe("computeImpactPrice", () => {
  it("prices hours x rates with contingency and tax", () => {
    const breakdown = computeImpactPrice({
      lines: [
        { label: "Build", role: "Senior Engineer", hours: 10 },
        { label: "Mockups", role: "Designer", hours: 4 },
      ],
      rates: RATES,
      currency: "USD",
      contingencyPct: 10,
      taxPct: 5,
    });
    // 10*8000 + 4*5000 = 100000; +10% = 110000; +5% tax = 115500.
    expect(breakdown.lines.map((l) => l.lineMinor)).toEqual([80000, 20000]);
    expect(breakdown.subtotalMinor).toBe(100000);
    expect(breakdown.contingencyMinor).toBe(10000);
    expect(breakdown.taxMinor).toBe(5500);
    expect(breakdown.totalMinor).toBe(115500);
  });

  it("supports fractional hours, zero contingency, and no tax line", () => {
    const breakdown = computeImpactPrice({
      lines: [{ label: "Fix", role: "Designer", hours: 1.5 }],
      rates: RATES,
      currency: "BDT",
    });
    expect(breakdown.totalMinor).toBe(7500);
    expect(breakdown.taxPct).toBeNull();
    expect(breakdown.taxMinor).toBe(0);
  });

  it("rejects unknown roles, bad percentages, and empty lines", () => {
    expect(() =>
      computeImpactPrice({ lines: [{ label: "X", role: "Wizard", hours: 1 }], rates: RATES, currency: "USD" }),
    ).toThrowError(/no rate/);
    expect(() =>
      computeImpactPrice({ lines: [{ label: "X", role: "Designer", hours: 1 }], rates: RATES, currency: "USD", contingencyPct: 101 }),
    ).toThrowError(/percentage/);
    expect(() => computeImpactPrice({ lines: [], rates: RATES, currency: "USD" })).toThrowError(/At least one/);
    expect(() =>
      computeImpactPrice({ lines: [{ label: "X", role: "Designer", hours: -1 }], rates: RATES, currency: "USD" }),
    ).toThrowError(/hours/);
  });
});

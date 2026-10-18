import { describe, expect, it } from "vitest";
import {
  assertOptionAgreement,
  assertSendableOptions,
  assertValidChoice,
  MAX_OPTIONS,
  MIN_OPTIONS,
} from "../src/options.js";

const opt = (over: Record<string, unknown> = {}) => ({
  id: "opt_1",
  label: "Full",
  effortDays: 5,
  priceMinor: 100000,
  currency: "USD",
  ...over,
});

describe("proposal options", () => {
  it("accepts no options", () => {
    expect(assertSendableOptions([])).toBeNull();
  });

  it("accepts 2-4 priced options and tiers on the highest price", () => {
    expect(
      assertSendableOptions([
        opt({ id: "a", label: "Full", priceMinor: 200000 }),
        opt({ id: "b", label: "Reduced", priceMinor: 80000 }),
      ]),
    ).toBe(200000);
    expect(
      assertSendableOptions([
        opt({ id: "a", label: "A", priceMinor: 1 }),
        opt({ id: "b", label: "B", priceMinor: 2 }),
        opt({ id: "c", label: "C", priceMinor: 3 }),
        opt({ id: "d", label: "D", priceMinor: 4 }),
      ]),
    ).toBe(4);
    expect(MIN_OPTIONS).toBe(2);
    expect(MAX_OPTIONS).toBe(4);
  });

  it("rejects a lone option and more than four", () => {
    expect(() => assertSendableOptions([opt()])).toThrowError(/2-4/);
    const five = ["a", "b", "c", "d", "e"].map((id, i) => opt({ id, label: `O${i}` }));
    expect(() => assertSendableOptions(five)).toThrowError(/2-4/);
  });

  it("rejects unpriced options, missing effort, and duplicate labels", () => {
    const base = opt({ id: "a", label: "Full" });
    expect(() => assertSendableOptions([base, opt({ id: "b", label: "X", priceMinor: null })])).toThrowError(/price/);
    expect(() => assertSendableOptions([base, opt({ id: "b", label: "X", currency: null })])).toThrowError(/price/);
    expect(() => assertSendableOptions([base, opt({ id: "b", label: "X", effortDays: null })])).toThrowError(/effort/);
    expect(() => assertSendableOptions([base, opt({ id: "b", label: "  full " })])).toThrowError(/Duplicate/);
    expect(() => assertSendableOptions([base, opt({ id: "b", label: "   " })])).toThrowError(/label/);
  });

  it("validates the client's pick against the snapshot", () => {
    const options = [
      { optionId: "a", label: "Full" },
      { optionId: "b", label: "Reduced" },
    ];
    expect(assertValidChoice(options, "b").label).toBe("Reduced");
    expect(() => assertValidChoice(options, "invented")).toThrowError(/not part of this review package/);
  });

  it("requires multi-approver option agreement", () => {
    expect(() => assertOptionAgreement([], "a")).not.toThrow();
    expect(() => assertOptionAgreement([null, "a"], "a")).not.toThrow();
    expect(() => assertOptionAgreement(["a"], "b")).toThrowError(/different option/);
  });
});

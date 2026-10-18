import { describe, expect, it } from "vitest";
import { drawAmountFor, drawBlocker, objectionBlocker, objectionDeadline, poolBalance } from "../src/allowance.js";

describe("allowance pools", () => {
  it("derives AMOUNT balances and ignores released draw-downs", () => {
    const balance = poolBalance({
      kind: "AMOUNT",
      totalHours: null,
      totalMinor: 100000,
      drawDowns: [
        { hours: null, amountMinor: 30000, status: "NOTIFIED" },
        { hours: null, amountMinor: 50000, status: "RELEASED" },
      ],
    });
    expect(balance.remainingMinor).toBe(70000);
    expect(balance.exhausted).toBe(false);
  });

  it("derives HOURS balances at 8 hours per effort-day", () => {
    expect(drawAmountFor({ kind: "HOURS", priceMinor: null, effortDays: 2.5 })).toEqual({ hours: 20, amountMinor: null });
    const balance = poolBalance({
      kind: "HOURS",
      totalHours: 40,
      totalMinor: null,
      drawDowns: [{ hours: 20, amountMinor: null, status: "FINAL" }],
    });
    expect(balance.remainingHours).toBe(20);
  });

  it("blocks draws that exceed the remaining balance", () => {
    expect(
      drawBlocker({
        kind: "AMOUNT",
        totalHours: null,
        totalMinor: 10000,
        drawDowns: [{ hours: null, amountMinor: 9000, status: "NOTIFIED" }],
        draw: { hours: null, amountMinor: 2000 },
      }),
    ).toMatch(/does not cover/);
    expect(
      drawBlocker({
        kind: "AMOUNT",
        totalHours: null,
        totalMinor: 10000,
        drawDowns: [],
        draw: { hours: null, amountMinor: 2000 },
      }),
    ).toBeNull();
  });

  it("requires priced impacts for AMOUNT and effort for HOURS", () => {
    expect(() => drawAmountFor({ kind: "AMOUNT", priceMinor: null, effortDays: 1 })).toThrowError(/priced impact/);
    expect(() => drawAmountFor({ kind: "HOURS", priceMinor: 5, effortDays: null })).toThrowError(/effort days/);
  });

  it("bounds objections by status and deadline", () => {
    const deadline = objectionDeadline("2026-10-01T00:00:00.000Z", 72);
    expect(deadline).toBe("2026-10-04T00:00:00.000Z");
    expect(objectionBlocker({ status: "NOTIFIED", deadline, now: "2026-10-02T00:00:00.000Z" })).toBeNull();
    expect(objectionBlocker({ status: "NOTIFIED", deadline, now: "2026-10-05T00:00:00.000Z" })).toMatch(/lapsed/);
    expect(objectionBlocker({ status: "OBJECTED", deadline, now: "2026-10-02T00:00:00.000Z" })).toMatch(/OBJECTED/);
    expect(() => objectionDeadline("2026-10-01T00:00:00.000Z", 0)).toThrowError(/window/i);
  });
});

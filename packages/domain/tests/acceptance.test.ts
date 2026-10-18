import { describe, expect, it } from "vitest";
import {
  acceptanceRequirementStatus,
  deemedAcceptanceDays,
  defaultAcceptanceExpiry,
  isAcceptancePackage,
  isDeemedDue,
} from "../src/acceptance.js";

describe("isAcceptancePackage", () => {
  it("detects packages covering requirements", () => {
    expect(isAcceptancePackage({ acceptanceRequirementIds: [] })).toBe(false);
    expect(isAcceptancePackage({ acceptanceRequirementIds: ["req_1"] })).toBe(true);
  });
});

describe("deemedAcceptanceDays", () => {
  it("accepts 1-90 day windows and rejects anything else", () => {
    expect(deemedAcceptanceDays({ deemedAcceptanceDays: 7 })).toBe(7);
    expect(deemedAcceptanceDays({ deemedAcceptanceDays: 1 })).toBe(1);
    expect(deemedAcceptanceDays({ deemedAcceptanceDays: 90 })).toBe(90);
    expect(deemedAcceptanceDays({})).toBe(null);
    expect(deemedAcceptanceDays({ deemedAcceptanceDays: null })).toBe(null);
    expect(deemedAcceptanceDays({ deemedAcceptanceDays: 0 })).toBe(null);
    expect(deemedAcceptanceDays({ deemedAcceptanceDays: 91 })).toBe(null);
    expect(deemedAcceptanceDays({ deemedAcceptanceDays: 2.5 })).toBe(null);
  });
});

describe("defaultAcceptanceExpiry", () => {
  it("adds whole days to now", () => {
    expect(defaultAcceptanceExpiry(new Date("2026-10-18T00:00:00.000Z"), 7)).toBe("2026-10-25T00:00:00.000Z");
  });
});

describe("isDeemedDue", () => {
  const base = { status: "SENT", expiresAt: "2026-10-18T00:00:00.000Z", nowIso: "2026-10-19T00:00:00.000Z", settings: { deemedAcceptanceDays: 7 } };
  it("is due when a configured SENT package passed its deadline", () => {
    expect(isDeemedDue(base)).toBe(true);
  });
  it("is not due when disabled, undecided-state, unexpired, or dateless", () => {
    expect(isDeemedDue({ ...base, settings: {} })).toBe(false);
    expect(isDeemedDue({ ...base, status: "DECIDED" })).toBe(false);
    expect(isDeemedDue({ ...base, nowIso: "2026-10-17T00:00:00.000Z" })).toBe(false);
    expect(isDeemedDue({ ...base, expiresAt: null })).toBe(false);
  });
});

describe("acceptanceRequirementStatus", () => {
  it("maps terminal verdicts to requirement outcomes", () => {
    expect(acceptanceRequirementStatus("APPROVED")).toBe("ACCEPTED");
    expect(acceptanceRequirementStatus("REJECTED")).toBe("IN_PROGRESS");
    expect(acceptanceRequirementStatus("CHANGES_REQUESTED")).toBe(null);
  });
});

import { describe, expect, it } from "vitest";
import { isChannelEligible, normalizePhoneE164 } from "../src/channels.js";

describe("isChannelEligible", () => {
  it("admits approval lifecycle events only", () => {
    for (const type of [
      "APPROVAL_REQUESTED",
      "APPROVAL_DECIDED",
      "APPROVAL_ESCALATED",
      "APPROVAL_EXPIRED",
      "APPROVAL_REMINDER",
      "ACCEPTANCE_DEEMED",
    ]) {
      expect(isChannelEligible(type)).toBe(true);
    }
    for (const type of ["SCOPE_PUBLISHED", "CHANGE_CREATED", "INTAKE_SUBMITTED", "APPROVAL_INVALIDATED", "", "slack"]) {
      expect(isChannelEligible(type)).toBe(false);
    }
  });
});

describe("normalizePhoneE164", () => {
  it("accepts strict E.164", () => {
    expect(normalizePhoneE164("+8801712345678")).toBe("+8801712345678");
    expect(normalizePhoneE164("+14155552671")).toBe("+14155552671");
  });

  it("strips common separators", () => {
    expect(normalizePhoneE164("+880 1712-345678")).toBe("+8801712345678");
    expect(normalizePhoneE164("+1 (415) 555-2671")).toBe("+14155552671");
    expect(normalizePhoneE164("  +8801712345678  ")).toBe("+8801712345678");
  });

  it("rejects non-E.164 input", () => {
    expect(normalizePhoneE164(null)).toBeNull();
    expect(normalizePhoneE164(undefined)).toBeNull();
    expect(normalizePhoneE164("")).toBeNull();
    expect(normalizePhoneE164("01712345678")).toBeNull();
    expect(normalizePhoneE164("+0123")).toBeNull();
    expect(normalizePhoneE164("+123456")).toBeNull();
    expect(normalizePhoneE164("+1234567890123456")).toBeNull();
    expect(normalizePhoneE164("+88017ABC5678")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  STEP_UP_CODE_DIGITS,
  STEP_UP_MAX_ATTEMPTS,
  assertChallengeUsable,
  assertMayRequest,
  effectiveStepUp,
  generateStepUpCode,
  hashStepUpCode,
  normalizeTypedName,
} from "../src/stepup.js";

const NOW = "2026-10-18T12:00:00.000Z";

describe("step-up verification", () => {
  it("generates zero-padded six-digit codes, stored hashed", () => {
    for (let i = 0; i < 25; i++) {
      const code = generateStepUpCode();
      expect(code).toMatch(/^\d{6}$/);
      expect(code).toHaveLength(STEP_UP_CODE_DIGITS);
    }
    expect(hashStepUpCode("123456")).not.toContain("123456");
    expect(hashStepUpCode("123456")).toBe(hashStepUpCode("123456"));
    expect(hashStepUpCode("123456")).not.toBe(hashStepUpCode("654321"));
  });

  it("resolves project-over-org-over-off, failing closed on junk", () => {
    expect(effectiveStepUp(null, null)).toEqual({ otp: false, typedName: false });
    expect(effectiveStepUp({ otp: true }, null)).toEqual({ otp: true, typedName: false });
    expect(effectiveStepUp({ otp: true, typedName: true }, { otp: false, typedName: null })).toEqual({
      otp: false,
      typedName: true,
    });
    expect(effectiveStepUp({ otp: "yes" }, [{ otp: true }])).toEqual({ otp: false, typedName: false });
  });

  it("gates challenges on consumed/expired/attempts", () => {
    const fresh = { expiresAt: "2026-10-18T12:09:00.000Z", attempts: 0, maxAttempts: STEP_UP_MAX_ATTEMPTS, consumedAt: null };
    expect(() => assertChallengeUsable(fresh, NOW)).not.toThrow();
    expect(() => assertChallengeUsable({ ...fresh, consumedAt: NOW }, NOW)).toThrowError(/already used/);
    expect(() => assertChallengeUsable({ ...fresh, expiresAt: NOW }, NOW)).toThrowError(/expired/);
    expect(() => assertChallengeUsable({ ...fresh, attempts: STEP_UP_MAX_ATTEMPTS }, NOW)).toThrowError(/Too many/);
  });

  it("rate-limits code requests by cooldown and active cap", () => {
    const nowMs = Date.parse(NOW);
    expect(() => assertMayRequest([], nowMs)).not.toThrow();
    expect(() => assertMayRequest([{ createdAt: "2026-10-18T11:59:30.000Z" }], nowMs)).toThrowError(/Wait 60 seconds/);
    expect(() => assertMayRequest([{ createdAt: "2026-10-18T11:58:00.000Z" }], nowMs)).not.toThrow();
    const three = [1, 2, 3].map(() => ({ createdAt: "2026-10-18T11:50:00.000Z" }));
    expect(() => assertMayRequest(three, nowMs)).toThrowError(/Too many active codes/);
  });

  it("requires a real typed name only when configured", () => {
    expect(normalizeTypedName("  Ada Lovelace ", true)).toBe("Ada Lovelace");
    expect(normalizeTypedName(undefined, false)).toBeNull();
    expect(() => normalizeTypedName("   ", true)).toThrowError(/full name/);
    expect(() => normalizeTypedName("X", true)).toThrowError(/full name/);
  });
});

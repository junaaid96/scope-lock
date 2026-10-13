import { describe, expect, it } from "vitest";
import {
  assertManualChangeTransition,
  assertTransition,
  ApprovalTransitions,
  ChangeTransitions,
  DomainError,
  RequirementTransitions,
} from "../src/index.js";

describe("transitions", () => {
  it("allows the happy-path change lifecycle", () => {
    const path = ["DRAFT", "SUBMITTED", "TRIAGING", "ESTIMATING", "PENDING_APPROVAL"] as const;
    for (let i = 1; i < path.length; i++) {
      expect(() => assertTransition(ChangeTransitions, path[i - 1], path[i], "change")).not.toThrow();
    }
  });

  it("rejects illegal jumps with a conflict error", () => {
    expect(() => assertTransition(ChangeTransitions, "DRAFT", "APPROVED", "change")).toThrowError(
      DomainError,
    );
    try {
      assertTransition(ChangeTransitions, "DRAFT", "APPROVED", "change");
      expect.unreachable();
    } catch (err) {
      expect((err as DomainError).code).toBe("CONFLICT");
    }
  });

  it("blocks manual PATCH to decision-driven statuses", () => {
    expect(() => assertManualChangeTransition("PENDING_APPROVAL", "APPROVED")).toThrowError(
      /only be reached through an approval decision/,
    );
    expect(() => assertManualChangeTransition("ESTIMATING", "PENDING_APPROVAL")).toThrowError(
      /only be reached through an approval decision/,
    );
  });

  it("allows approval invalidation from draft/sent only", () => {
    expect(() => assertTransition(ApprovalTransitions, "SENT", "INVALIDATED", "approval")).not.toThrow();
    expect(() => assertTransition(ApprovalTransitions, "DECIDED", "INVALIDATED", "approval")).toThrowError(
      DomainError,
    );
  });

  it("keeps requirement lifecycle ordered", () => {
    expect(() => assertTransition(RequirementTransitions, "PROPOSED", "ACCEPTED", "req")).toThrowError(
      DomainError,
    );
    expect(() =>
      assertTransition(RequirementTransitions, "DELIVERED", "ACCEPTED", "req"),
    ).not.toThrow();
  });
});

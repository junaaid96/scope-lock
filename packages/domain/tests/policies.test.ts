import { describe, expect, it } from "vitest";
import { aggregatePolicy, currentTurn, resolvePolicyMode, type PolicyVote } from "../src/policies.js";

const vote = (approverKey: string, decision: PolicyVote["decision"]): PolicyVote => ({ tokenId: `tok-${approverKey}`, approverKey, decision });

describe("approval policies", () => {
  it("ANY: first vote wins, silence pends", () => {
    expect(aggregatePolicy({ mode: "ANY", approverOrder: [] }, ["a", "b"], [])).toEqual({ state: "PENDING", awaiting: ["a", "b"] });
    expect(aggregatePolicy({ mode: "ANY", approverOrder: [] }, ["a", "b"], [vote("b", "APPROVED")])).toEqual({ state: "APPROVED", by: ["b"] });
    expect(aggregatePolicy({ mode: "ANY", approverOrder: [] }, ["a", "b"], [vote("a", "REJECTED"), vote("b", "APPROVED")])).toEqual({
      state: "REJECTED",
      by: ["a"],
    });
  });

  it("ALL: unanimous approve wins; any reject rejects; partial pends", () => {
    const policy = { mode: "ALL" as const, approverOrder: [] as string[] };
    expect(aggregatePolicy(policy, ["a", "b"], [vote("a", "APPROVED")])).toEqual({ state: "PENDING", awaiting: ["b"] });
    expect(aggregatePolicy(policy, ["a", "b"], [vote("a", "APPROVED"), vote("b", "APPROVED")])).toEqual({ state: "APPROVED", by: ["a", "b"] });
    expect(aggregatePolicy(policy, ["a", "b"], [vote("a", "APPROVED"), vote("b", "REJECTED")])).toEqual({ state: "REJECTED", by: ["b"] });
    expect(aggregatePolicy(policy, ["a", "b"], [vote("a", "REJECTED")])).toEqual({ state: "REJECTED", by: ["a"] });
    expect(aggregatePolicy(policy, ["a", "b"], [vote("a", "APPROVED"), vote("b", "CHANGES_REQUESTED")])).toEqual({
      state: "CHANGES_REQUESTED",
      by: ["b"],
    });
    // Rejection outranks a changes-request in the same round.
    expect(aggregatePolicy(policy, ["a", "b", "c"], [vote("a", "CHANGES_REQUESTED"), vote("b", "REJECTED")])).toEqual({
      state: "REJECTED",
      by: ["b"],
    });
  });

  it("SEQUENTIAL: turns advance on approve, end on reject or changes-requested", () => {
    const policy = { mode: "SEQUENTIAL" as const, approverOrder: ["a", "b", "c"] };
    expect(aggregatePolicy(policy, ["a", "b", "c"], [])).toEqual({ state: "PENDING", awaiting: ["a"] });
    expect(currentTurn(policy, ["a", "b", "c"], [])).toBe("a");
    const one = [vote("a", "APPROVED")];
    expect(aggregatePolicy(policy, ["a", "b", "c"], one)).toEqual({ state: "PENDING", awaiting: ["b"] });
    expect(currentTurn(policy, ["a", "b", "c"], one)).toBe("b");
    expect(aggregatePolicy(policy, ["a", "b", "c"], [...one, vote("b", "REJECTED")])).toEqual({ state: "REJECTED", by: ["b"] });
    expect(aggregatePolicy(policy, ["a", "b", "c"], [...one, vote("b", "CHANGES_REQUESTED")])).toEqual({
      state: "CHANGES_REQUESTED",
      by: ["b"],
    });
    const all = [...one, vote("b", "APPROVED"), vote("c", "APPROVED")];
    expect(aggregatePolicy(policy, ["a", "b", "c"], all)).toEqual({ state: "APPROVED", by: ["a", "b", "c"] });
    expect(currentTurn(policy, ["a", "b", "c"], all)).toBeNull();
    expect(currentTurn({ mode: "ALL", approverOrder: [] }, ["a"], [])).toBeNull();
  });

  it("rejects empty approvers and mismatched orders", () => {
    expect(() => aggregatePolicy({ mode: "ALL", approverOrder: [] }, [], [])).toThrow(/at least one approver/);
    expect(() => aggregatePolicy({ mode: "SEQUENTIAL", approverOrder: ["a"] }, ["a", "b"], [])).toThrow(/exactly once/);
    expect(() => aggregatePolicy({ mode: "SEQUENTIAL", approverOrder: ["a", "zzz"] }, ["a", "b"], [])).toThrow(/exactly once/);
  });

  it("resolves modes from amount thresholds", () => {
    const rules = [
      { uptoMinor: 100000, mode: "ANY" as const },
      { uptoMinor: 1000000, mode: "ALL" as const },
      { uptoMinor: null, mode: "SEQUENTIAL" as const },
    ];
    expect(resolvePolicyMode(rules, 50000)).toBe("ANY");
    expect(resolvePolicyMode(rules, 100000)).toBe("ANY");
    expect(resolvePolicyMode(rules, 100001)).toBe("ALL");
    expect(resolvePolicyMode(rules, 5000000)).toBe("SEQUENTIAL");
    expect(resolvePolicyMode(rules, null)).toBe("SEQUENTIAL");
    expect(() => resolvePolicyMode([], 10)).toThrow(/At least one/);
    expect(() => resolvePolicyMode([{ uptoMinor: 5, mode: "ANY" }, { uptoMinor: 5, mode: "ALL" }], 10)).toThrow(/ascend/);
  });
});

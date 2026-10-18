import { describe, expect, it } from "vitest";
import { computeScopeHealth } from "../src/health.js";
import { parseExternalRefs, splitExternalRef } from "../src/external.js";

describe("parseExternalRefs", () => {
  it("extracts CHG and REQ identifiers", () => {
    expect(parseExternalRefs("Implements CHG-001 and REQ-042")).toEqual(["CHG-001", "REQ-042"]);
  });

  it("dedupes while preserving order", () => {
    expect(parseExternalRefs("CHG-002 then REQ-001 then CHG-002 again")).toEqual(["CHG-002", "REQ-001"]);
  });

  it("ignores short numbers, lowercase, and unknown prefixes", () => {
    expect(parseExternalRefs("CHG-12 chg-001 REQ-1 ABC-123 CHG-0001")).toEqual(["CHG-0001"]);
  });

  it("finds refs inside branches and commit subjects", () => {
    expect(parseExternalRefs("feature/CHG-007-dark-mode")).toEqual(["CHG-007"]);
    expect(parseExternalRefs("fix: scope note (REQ-010)\n\nBody without refs")).toEqual(["REQ-010"]);
  });

  it("returns [] for empty input", () => {
    expect(parseExternalRefs("")).toEqual([]);
    expect(parseExternalRefs(null)).toEqual([]);
    expect(parseExternalRefs(undefined)).toEqual([]);
    expect(parseExternalRefs("no identifiers here")).toEqual([]);
  });
});

describe("splitExternalRef", () => {
  it("splits canonical refs by kind", () => {
    expect(splitExternalRef("CHG-001")).toEqual({ kind: "CHANGE", ref: "CHG-001" });
    expect(splitExternalRef("REQ-123")).toEqual({ kind: "REQUIREMENT", ref: "REQ-123" });
  });

  it("rejects malformed refs", () => {
    expect(splitExternalRef("CHG-1")).toBeNull();
    expect(splitExternalRef("chg-001")).toBeNull();
    expect(splitExternalRef("CHG-001 ")).toBeNull();
    expect(splitExternalRef("ABC-001")).toBeNull();
    expect(splitExternalRef("")).toBeNull();
  });
});

describe("unlinked-work health signal", () => {
  function base(overrides: Record<string, unknown> = {}) {
    return computeScopeHealth({
      nowIso: "2026-01-10T00:00:00.000Z",
      openRequests: [],
      pendingApprovals: [],
      expiredApprovals: [],
      unlinkedRequests: [],
      unapprovedImplementations: [],
      ...overrides,
    });
  }

  it("reports zero with an explanation when nothing is unlinked", () => {
    const health = base();
    const signal = health.signals.find((s) => s.key === "unlinked-work");
    expect(signal?.count).toBe(0);
    expect(signal?.detail).toContain("Every merged external change");
  });

  it("counts merged work that links to no request and dents the score", () => {
    const clean = base();
    const flagged = base({
      unlinkedWork: [
        { id: "w1", title: "octo/repo#9" },
        { id: "w2", title: "octo/repo#10" },
        { id: "w3", title: "octo/repo#11" },
        { id: "w4", title: "octo/repo#12" },
      ],
    });
    const signal = flagged.signals.find((s) => s.key === "unlinked-work");
    expect(signal?.count).toBe(4);
    expect(signal?.itemIds).toEqual(["w1", "w2", "w3", "w4"]);
    expect(signal?.detail).toContain("outside ScopeLock");
    expect(flagged.score).toBeLessThan(clean.score);
  });
});

import { describe, expect, it } from "vitest";
import { checksumOf, canonicalize } from "../src/checksum.js";
import { diffRevisions, type RevisionLike } from "../src/diff.js";
import { detectDrift } from "../src/drift.js";
import { computeScopeHealth } from "../src/health.js";
import { combineBundlePrice, formatMinorUnits } from "../src/money.js";
import { afterCursor, encodeCursor, paginate } from "../src/pagination.js";

const rev = (over: Partial<RevisionLike> & { requirementId: string }): RevisionLike => ({
  stableKey: "REQ-1",
  title: "t",
  description: "d",
  acceptanceCriteria: [],
  category: null,
  priority: null,
  order: 0,
  ...over,
});

describe("domain rules", () => {
  it("checksums are stable regardless of key order", () => {
    expect(checksumOf({ b: 1, a: { d: 4, c: 3 } })).toBe(checksumOf({ a: { c: 3, d: 4 }, b: 1 }));
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("diffs label additions, removals, and field-level edits", () => {
    const from = [rev({ requirementId: "r1", title: "Old" }), rev({ requirementId: "r2" })];
    const to = [
      rev({ requirementId: "r1", title: "New" }),
      rev({ requirementId: "r3", stableKey: "REQ-3" }),
    ];
    const diff = diffRevisions("v1", "v2", from, to);
    expect(diff.added.map((r) => r.requirementId)).toEqual(["r3"]);
    expect(diff.removed.map((r) => r.requirementId)).toEqual(["r2"]);
    expect(diff.modified).toHaveLength(1);
    expect(diff.modified[0]?.changes).toEqual([{ field: "title", before: "Old", after: "New" }]);
  });

  it("detects drift deterministically with evidence", () => {
    const out = detectDrift("Please add Single Sign-On with SAML for the dashboard login", [
      {
        requirementId: "r1",
        stableKey: "REQ-1",
        title: "SAML single sign-on for dashboard",
        description: "Support SAML login flows",
        acceptanceCriteria: ["login via identity provider"],
      },
      {
        requirementId: "r2",
        stableKey: "REQ-2",
        title: "Export invoices to CSV",
        description: "Monthly bookkeeping export",
        acceptanceCriteria: [],
      },
    ]);
    expect(out[0]?.requirementId).toBe("r1");
    expect(out[0]?.matchedTerms.length).toBeGreaterThan(0);
    expect(out[0]?.excerpt.length).toBeGreaterThan(0);
    expect(out.find((s) => s.requirementId === "r2")).toBeUndefined();
  });

  it("explains every health input", () => {
    const health = computeScopeHealth({
      nowIso: "2026-01-10T00:00:00.000Z",
      openRequests: [{ id: "c1", status: "SUBMITTED", updatedAt: "2025-12-01T00:00:00.000Z", title: "old" }],
      pendingApprovals: [],
      expiredApprovals: [{ id: "a1", changeTitle: "x" }],
      unlinkedRequests: [],
      unapprovedImplementations: [],
    });
    expect(health.score).toBeLessThan(5);
    expect(health.signals).toHaveLength(5);
    expect(health.signals.every((s) => s.detail.length > 0)).toBe(true);
  });

  it("keeps money in integer minor units", () => {
    expect(combineBundlePrice([1000, 250], -100)).toBe(1150);
    expect(() => combineBundlePrice([100], -200)).toThrowError(/negative/);
    expect(formatMinorUnits(1999, "USD")).toBe("USD 19.99");
  });

  it("paginates with opaque cursors", () => {
    const rows = [
      { id: "c", createdAt: "2026-01-03T00:00:00.000Z" },
      { id: "b", createdAt: "2026-01-02T00:00:00.000Z" },
      { id: "a", createdAt: "2026-01-01T00:00:00.000Z" },
    ];
    const p1 = paginate(rows, 2);
    expect(p1.items.map((r) => r.id)).toEqual(["c", "b"]);
    expect(p1.nextCursor).toBeTruthy();
    const rest = afterCursor(rows, p1.nextCursor ?? undefined);
    expect(rest.map((r) => r.id)).toEqual(["a"]);
    expect(encodeCursor({ t: "x", i: "y" })).not.toContain("x");
  });
});

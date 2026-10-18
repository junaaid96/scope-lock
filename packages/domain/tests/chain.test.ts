import { describe, expect, it } from "vitest";
import {
  GENESIS_PREV_HASH,
  auditChainKey,
  chainEventHash,
  isLegacyChainEvent,
  verifyAuditChain,
  type ChainableAuditEvent,
} from "../src/chain.js";

function chained(seq: number, prevHash: string, over: Partial<ChainableAuditEvent> = {}): ChainableAuditEvent {
  const rest = {
    id: `aud_${seq}`,
    organizationId: "org_1",
    projectId: "prj_1",
    actorId: "usr_1",
    actorEmail: "a@test.dev",
    action: "change.submitted",
    targetType: "CHANGE",
    targetId: "chg_1",
    before: undefined as unknown,
    after: { status: "SUBMITTED" } as unknown,
    correlationId: `corr-${seq}`,
    ip: null,
    createdAt: `2026-10-18T10:00:0${seq}.000Z`,
    chainSeq: seq,
    ...over,
  };
  return { ...rest, prevHash, hash: chainEventHash(prevHash, rest) };
}

function buildChain(n: number): ChainableAuditEvent[] {
  const rows: ChainableAuditEvent[] = [];
  let prev = GENESIS_PREV_HASH;
  for (let seq = 1; seq <= n; seq++) {
    const row = chained(seq, prev);
    rows.push(row);
    prev = row.hash;
  }
  return rows;
}

describe("auditChainKey", () => {
  it("chains project events per project and org events per org", () => {
    expect(auditChainKey({ projectId: "prj_1", organizationId: "org_1" })).toBe("project:prj_1");
    expect(auditChainKey({ projectId: null, organizationId: "org_1" })).toBe("org:org_1");
  });
});

describe("isLegacyChainEvent", () => {
  it("treats empty hash or sequence 0 as legacy", () => {
    expect(isLegacyChainEvent({ hash: "", chainSeq: 0 })).toBe(true);
    expect(isLegacyChainEvent({ hash: "", chainSeq: 3 })).toBe(true);
    expect(isLegacyChainEvent({ hash: "abc", chainSeq: 0 })).toBe(true);
    expect(isLegacyChainEvent({ hash: "abc", chainSeq: 1 })).toBe(false);
  });
});

describe("chainEventHash", () => {
  it("is deterministic for the same payload", () => {
    const a = chained(1, GENESIS_PREV_HASH);
    const b = chained(1, GENESIS_PREV_HASH);
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any chained field changes", () => {
    const base = chained(1, GENESIS_PREV_HASH);
    const { prevHash: _ignoredPrev, hash: _ignoredHash, ...rest } = base;
    void _ignoredPrev;
    void _ignoredHash;
    expect(chainEventHash("other-prev", rest)).not.toBe(base.hash);
    expect(chainEventHash(base.prevHash, { ...rest, action: "change.approved" })).not.toBe(base.hash);
    expect(chainEventHash(base.prevHash, { ...rest, after: { status: "APPROVED" } })).not.toBe(base.hash);
    expect(chainEventHash(base.prevHash, { ...rest, chainSeq: 2 })).not.toBe(base.hash);
  });
});

describe("verifyAuditChain", () => {
  it("accepts a well-formed chain starting at genesis", () => {
    const rows = buildChain(5);
    expect(verifyAuditChain(rows)).toEqual({ valid: true, checked: 5, legacy: 0, breakAtSeq: null, reason: null });
  });

  it("accepts an empty chain", () => {
    expect(verifyAuditChain([])).toEqual({ valid: true, checked: 0, legacy: 0, breakAtSeq: null, reason: null });
  });

  it("skips legacy rows and still verifies the chained tail", () => {
    const legacy: ChainableAuditEvent = {
      ...chained(1, GENESIS_PREV_HASH),
      id: "aud_legacy",
      chainSeq: 0,
      prevHash: GENESIS_PREV_HASH,
      hash: "",
    };
    const rows = [legacy, ...buildChain(3)];
    expect(verifyAuditChain(rows)).toEqual({ valid: true, checked: 3, legacy: 1, breakAtSeq: null, reason: null });
  });

  it("rejects edited content", () => {
    const rows = buildChain(3);
    const tampered = rows.map((r) => (r.chainSeq === 2 ? { ...r, action: "change.approved" } : r));
    const result = verifyAuditChain(tampered);
    expect(result.valid).toBe(false);
    expect(result.breakAtSeq).toBe(2);
    expect(result.reason).toMatch(/hash mismatch/);
  });

  it("rejects a removed link", () => {
    const rows = buildChain(3).filter((r) => r.chainSeq !== 2);
    const result = verifyAuditChain(rows);
    expect(result.valid).toBe(false);
    expect(result.breakAtSeq).toBe(3);
    expect(result.reason).toMatch(/sequence gap/);
  });

  it("rejects reordered rows", () => {
    const rows = buildChain(3).reverse();
    const result = verifyAuditChain(rows);
    expect(result.valid).toBe(false);
    expect(result.breakAtSeq).not.toBe(null);
  });

  it("rejects a spliced row from another chain", () => {
    const rows = buildChain(3);
    const foreign = chained(2, "deadbeef");
    const spliced = rows.map((r) => (r.chainSeq === 2 ? foreign : r));
    const result = verifyAuditChain(spliced);
    expect(result.valid).toBe(false);
    expect(result.breakAtSeq).toBe(2);
  });

  it("rejects a chain that does not start at genesis", () => {
    const rows = buildChain(2);
    const shifted = rows.map((r) => (r.chainSeq === 1 ? { ...r, prevHash: "tampered" } : r));
    // Recompute row 1's hash so the break surfaces as a linkage break, not content.
    const [first, ...tail] = shifted;
    const { prevHash: _ignoredPrev, hash: _ignoredHash, ...firstRest } = first;
    void _ignoredPrev;
    void _ignoredHash;
    const relinked = { ...first, hash: chainEventHash(first.prevHash, firstRest) };
    const result = verifyAuditChain([relinked, ...tail]);
    expect(result.valid).toBe(false);
    expect(result.breakAtSeq).toBe(1);
    expect(result.reason).toMatch(/prevHash mismatch/);
  });
});

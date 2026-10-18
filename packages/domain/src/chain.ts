import { checksumOf } from "./checksum.js";

/**
 * Tamper-evident audit hash chain. Every audit event carries `prevHash` +
 * `hash` (SHA-256 over canonical JSON) plus a per-chain sequence number, so
 * any edit, deletion, or reorder of history breaks verification.
 *
 * Chains are per project; org-level events (no project) chain under the org.
 * Events written before the chain existed carry the explicit genesis marker
 * with an empty hash and sequence 0, and verify as "legacy" rather than
 * "chained".
 */

/** Explicit marker starting every chain; also the prevHash of legacy rows. */
export const GENESIS_PREV_HASH = "GENESIS";

/** Empty hash marks a pre-chain legacy event (sequence 0). */
export const LEGACY_HASH = "";

export const CHAIN_VERSION = 1;

export function auditChainKey(input: { projectId: string | null; organizationId: string }): string {
  return input.projectId ? `project:${input.projectId}` : `org:${input.organizationId}`;
}

export interface ChainableAuditEvent {
  id: string;
  organizationId: string;
  projectId: string | null;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
  correlationId: string;
  ip: string | null;
  createdAt: string;
  chainSeq: number;
  prevHash: string;
  hash: string;
}

export function isLegacyChainEvent(event: Pick<ChainableAuditEvent, "hash" | "chainSeq">): boolean {
  return event.hash === LEGACY_HASH || event.chainSeq === 0;
}

/** Hash a chained event: SHA-256 over the canonical payload bound to prevHash. */
export function chainEventHash(prevHash: string, event: Omit<ChainableAuditEvent, "prevHash" | "hash">): string {
  return checksumOf({
    v: CHAIN_VERSION,
    prevHash,
    event: {
      id: event.id,
      organizationId: event.organizationId,
      projectId: event.projectId,
      actorId: event.actorId,
      actorEmail: event.actorEmail,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId,
      before: event.before ?? null,
      after: event.after ?? null,
      correlationId: event.correlationId,
      ip: event.ip,
      createdAt: event.createdAt,
      chainSeq: event.chainSeq,
    },
  });
}

export interface ChainVerifyResult {
  valid: boolean;
  /** Chained events checked (excludes legacy). */
  checked: number;
  /** Pre-chain legacy events skipped. */
  legacy: number;
  /** Sequence where verification broke, when invalid. */
  breakAtSeq: number | null;
  reason: string | null;
}

/**
 * Verify a chain ordered by chainSeq ascending. Legacy rows (empty hash or
 * sequence 0) are counted and skipped; every chained row must link to its
 * predecessor, keep sequence continuity, and recompute its stored hash.
 */
export function verifyAuditChain(events: ChainableAuditEvent[]): ChainVerifyResult {
  const invalid = (breakAtSeq: number | null, reason: string, checked: number, legacy: number): ChainVerifyResult => ({
    valid: false,
    checked,
    legacy,
    breakAtSeq,
    reason,
  });
  let checked = 0;
  let legacy = 0;
  let expectedPrev = GENESIS_PREV_HASH;
  let expectedSeq = 1;
  for (const event of events) {
    if (isLegacyChainEvent(event)) {
      legacy += 1;
      continue;
    }
    if (event.chainSeq !== expectedSeq) {
      return invalid(event.chainSeq, `sequence gap: expected ${expectedSeq}, found ${event.chainSeq}`, checked, legacy);
    }
    if (event.prevHash !== expectedPrev) {
      return invalid(event.chainSeq, `prevHash mismatch at sequence ${event.chainSeq}`, checked, legacy);
    }
    const { prevHash: _p, hash: _h, ...rest } = event;
    void _p;
    void _h;
    if (chainEventHash(event.prevHash, rest) !== event.hash) {
      return invalid(event.chainSeq, `hash mismatch at sequence ${event.chainSeq}: event content changed`, checked, legacy);
    }
    expectedPrev = event.hash;
    expectedSeq += 1;
    checked += 1;
  }
  return { valid: true, checked, legacy, breakAtSeq: null, reason: null };
}

import { DomainError } from "./errors.js";

/**
 * Approval policies: how a set of approvers reaches a terminal decision.
 *
 * - ANY: the first recorded decision wins (today's behavior, the default).
 * - ALL: every approver must approve; any rejection rejects; any
 *   changes-requested (without a rejection) sends the package back.
 * - SEQUENTIAL: approvers decide in `approverOrder`, one at a time. An
 *   approval advances the turn; a rejection or changes-requested ends the
 *   run terminally. Only the current approver's token may record.
 *
 * Aggregation is pure and exhaustive: every combination of policy × votes
 * maps to exactly one outcome. The API layer persists each decision and
 * applies side effects only when the outcome turns terminal.
 */

export type PolicyMode = "ANY" | "ALL" | "SEQUENTIAL";
export type VoteDecision = "APPROVED" | "REJECTED" | "CHANGES_REQUESTED";

export interface ApprovalPolicy {
  mode: PolicyMode;
  /** Approver keys (user id or email) in decision order (SEQUENTIAL only). */
  approverOrder: string[];
}

export interface PolicyVote {
  /** Token id that recorded the decision (null for session-authenticated decides). */
  tokenId: string | null;
  approverKey: string;
  decision: VoteDecision;
}

export type PolicyOutcome =
  | { state: "PENDING"; awaiting: string[] }
  | { state: "APPROVED"; by: string[] }
  | { state: "REJECTED"; by: string[] }
  | { state: "CHANGES_REQUESTED"; by: string[] };

export interface ThresholdRule {
  /** Prices at or below this (minor units) use this mode; null = no ceiling. */
  uptoMinor: number | null;
  mode: PolicyMode;
}

/**
 * Resolve the policy mode from amount thresholds. Rules apply in ascending
 * `uptoMinor` order; the first rule whose ceiling covers the price wins.
 * Unpriced impacts (null) use the last rule. Throws on empty/unsorted rules.
 */
export function resolvePolicyMode(rules: ThresholdRule[], priceMinor: number | null): PolicyMode {
  if (rules.length === 0) throw DomainError.unprocessable("At least one approval policy rule is required");
  let prev: number | null = null;
  for (const rule of rules) {
    if (prev !== null && rule.uptoMinor !== null && rule.uptoMinor <= prev) {
      throw DomainError.unprocessable("Approval policy ceilings must ascend");
    }
    if (rule.uptoMinor !== null) prev = rule.uptoMinor;
  }
  if (priceMinor === null) return rules[rules.length - 1]?.mode ?? "ANY";
  for (const rule of rules) {
    if (rule.uptoMinor === null || priceMinor <= rule.uptoMinor) return rule.mode;
  }
  return rules[rules.length - 1]?.mode ?? "ANY";
}

/** Latest vote per approver wins (re-decides are rejected upstream; this stays total). */
function latestVotes(votes: PolicyVote[]): Map<string, PolicyVote> {
  const latest = new Map<string, PolicyVote>();
  for (const vote of votes) latest.set(vote.approverKey, vote);
  return latest;
}

export function aggregatePolicy(policy: ApprovalPolicy, approverKeys: string[], votes: PolicyVote[]): PolicyOutcome {
  const distinctApprovers = [...new Set(approverKeys)];
  if (distinctApprovers.length === 0) throw DomainError.unprocessable("A policy needs at least one approver");
  const latest = latestVotes(votes);

  if (policy.mode === "ANY") {
    const first = votes[0];
    if (!first) return { state: "PENDING", awaiting: distinctApprovers };
    return { state: first.decision, by: [first.approverKey] };
  }

  if (policy.mode === "ALL") {
    const decided = distinctApprovers.filter((k) => latest.has(k));
    const byDecision = (d: VoteDecision): string[] => decided.filter((k) => latest.get(k)?.decision === d);
    const rejections = byDecision("REJECTED");
    if (rejections.length > 0) return { state: "REJECTED", by: rejections };
    const changeRequests = byDecision("CHANGES_REQUESTED");
    const approvals = byDecision("APPROVED");
    if (decided.length === distinctApprovers.length) {
      if (changeRequests.length > 0) return { state: "CHANGES_REQUESTED", by: changeRequests };
      return { state: "APPROVED", by: approvals };
    }
    return { state: "PENDING", awaiting: distinctApprovers.filter((k) => !latest.has(k)) };
  }

  // SEQUENTIAL
  const order = policy.approverOrder.length > 0 ? policy.approverOrder : distinctApprovers;
  if (order.length !== distinctApprovers.length || order.some((k) => !distinctApprovers.includes(k))) {
    throw DomainError.unprocessable("Sequential approver order must list every approver exactly once");
  }
  for (const key of order) {
    const vote = latest.get(key);
    if (!vote) return { state: "PENDING", awaiting: [key] };
    if (vote.decision === "REJECTED") return { state: "REJECTED", by: [key] };
    if (vote.decision === "CHANGES_REQUESTED") return { state: "CHANGES_REQUESTED", by: [key] };
  }
  return { state: "APPROVED", by: [...order] };
}

/** The approver key whose turn it is under SEQUENTIAL (null when terminal or another mode). */
export function currentTurn(policy: ApprovalPolicy, approverKeys: string[], votes: PolicyVote[]): string | null {
  if (policy.mode !== "SEQUENTIAL") return null;
  const outcome = aggregatePolicy(policy, approverKeys, votes);
  return outcome.state === "PENDING" ? (outcome.awaiting[0] ?? null) : null;
}

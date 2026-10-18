// Scope-health signals. Every input is explainable — never a black-box score alone.

export interface HealthInput {
  nowIso: string;
  agingThresholdDays?: number;
  openRequests: Array<{ id: string; status: string; updatedAt: string; title: string }>;
  pendingApprovals: Array<{ id: string; expiresAt: string | null; changeTitle: string }>;
  expiredApprovals: Array<{ id: string; changeTitle: string }>;
  unlinkedRequests: Array<{ id: string; title: string }>;
  /** Changes marked implemented without an approval decision trail. */
  unapprovedImplementations: Array<{ id: string; title: string }>;
  /** Merged external work (PRs, pushes) that references no ScopeLock request. */
  unlinkedWork?: Array<{ id: string; title: string }>;
}

export interface HealthSignal {
  key: "aging" | "pending" | "expired" | "unlinked" | "unapproved" | "unlinked-work";
  label: string;
  count: number;
  detail: string;
  itemIds: string[];
}

export interface ScopeHealth {
  score: 0 | 1 | 2 | 3 | 4 | 5;
  summary: string;
  signals: HealthSignal[];
  inputs: {
    agingThresholdDays: number;
    evaluatedAt: string;
    openRequestCount: number;
  };
}

const DAY_MS = 86_400_000;

export function computeScopeHealth(input: HealthInput): ScopeHealth {
  const threshold = input.agingThresholdDays ?? 7;
  const now = Date.parse(input.nowIso);
  const aging = input.openRequests.filter(
    (r) => now - Date.parse(r.updatedAt) > threshold * DAY_MS,
  );

  const signals: HealthSignal[] = [
    {
      key: "aging",
      label: "Aging requests",
      count: aging.length,
      detail:
        aging.length === 0
          ? `No open request is older than ${threshold} days.`
          : `${aging.length} open request(s) untouched for over ${threshold} days.`,
      itemIds: aging.map((r) => r.id),
    },
    {
      key: "pending",
      label: "Pending approvals",
      count: input.pendingApprovals.length,
      detail:
        input.pendingApprovals.length === 0
          ? "No proposals are waiting on a client decision."
          : `${input.pendingApprovals.length} proposal(s) awaiting client decision.`,
      itemIds: input.pendingApprovals.map((r) => r.id),
    },
    {
      key: "expired",
      label: "Expired approvals",
      count: input.expiredApprovals.length,
      detail:
        input.expiredApprovals.length === 0
          ? "No approval request has expired."
          : `${input.expiredApprovals.length} approval(s) expired without a decision — resend or withdraw.`,
      itemIds: input.expiredApprovals.map((r) => r.id),
    },
    {
      key: "unlinked",
      label: "Unlinked requests",
      count: input.unlinkedRequests.length,
      detail:
        input.unlinkedRequests.length === 0
          ? "Every request links to baseline requirements."
          : `${input.unlinkedRequests.length} request(s) have no linked requirement — traceability gap.`,
      itemIds: input.unlinkedRequests.map((r) => r.id),
    },
    {
      key: "unapproved",
      label: "Unapproved implementation",
      count: input.unapprovedImplementations.length,
      detail:
        input.unapprovedImplementations.length === 0
          ? "No work was marked implemented without approval."
          : `${input.unapprovedImplementations.length} change(s) implemented without an approval decision.`,
      itemIds: input.unapprovedImplementations.map((r) => r.id),
    },
    {
      key: "unlinked-work",
      label: "Unlinked work",
      count: (input.unlinkedWork ?? []).length,
      detail:
        (input.unlinkedWork ?? []).length === 0
          ? "Every merged external change links to a request."
          : `${(input.unlinkedWork ?? []).length} merged external change(s) link to no request — work happened outside ScopeLock.`,
      itemIds: (input.unlinkedWork ?? []).map((r) => r.id),
    },
  ];

  const penalty =
    Math.min(aging.length, 3) * 0.5 +
    Math.min(input.pendingApprovals.length, 4) * 0.25 +
    input.expiredApprovals.length * 1 +
    Math.min(input.unlinkedRequests.length, 4) * 0.25 +
    input.unapprovedImplementations.length * 1.5 +
    Math.min((input.unlinkedWork ?? []).length, 4) * 0.25;
  const score = Math.max(0, Math.min(5, Math.round(5 - penalty))) as ScopeHealth["score"];
  const worst = signals.filter((s) => s.count > 0).sort((a, b) => b.count - a.count)[0];
  return {
    score,
    summary:
      score === 5
        ? "Scope is healthy: no pending, aging, or unapproved work."
        : worst
          ? `Attention needed: ${worst.detail}`
          : "Scope needs attention.",
    signals,
    inputs: {
      agingThresholdDays: threshold,
      evaluatedAt: input.nowIso,
      openRequestCount: input.openRequests.length,
    },
  };
}

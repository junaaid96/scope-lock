/**
 * Delivery acceptance rules. Acceptance reuses the review-link mechanism:
 * an approval package covering delivered requirements, decided by the client
 * — or deemed accepted by policy when the deadline passes without objection.
 *
 * A deemed outcome is recorded with the policy actor and never creates a
 * client decision row.
 */

/** Audit actor marker for policy-driven outcomes (deemed acceptance). */
export const POLICY_ACTOR = "policy";

export interface AcceptancePackageRef {
  acceptanceRequirementIds: string[];
}

export function isAcceptancePackage(approval: AcceptancePackageRef): boolean {
  return approval.acceptanceRequirementIds.length > 0;
}

/** Deemed acceptance applies only when the project configured N days. */
export function deemedAcceptanceDays(settings: { deemedAcceptanceDays?: number | null }): number | null {
  const days = settings.deemedAcceptanceDays ?? null;
  return typeof days === "number" && Number.isInteger(days) && days >= 1 && days <= 90 ? days : null;
}

/** Default deadline for an acceptance send: now + N configured days. */
export function defaultAcceptanceExpiry(now: Date, days: number): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString();
}

/** A SENT acceptance package past its deadline is due for deemed acceptance. */
export function isDeemedDue(args: { status: string; expiresAt: string | null; nowIso: string; settings: { deemedAcceptanceDays?: number | null } }): boolean {
  return (
    args.status === "SENT" &&
    deemedAcceptanceDays(args.settings) !== null &&
    args.expiresAt !== null &&
    args.expiresAt <= args.nowIso
  );
}

export type AcceptanceTerminal = "APPROVED" | "REJECTED" | "CHANGES_REQUESTED";

/**
 * Requirement status after a terminal client verdict. Approvals accept;
 * rejections send the work back for rework; change requests leave the
 * delivery in place while the agency revises.
 */
export function acceptanceRequirementStatus(terminal: AcceptanceTerminal): "ACCEPTED" | "IN_PROGRESS" | null {
  if (terminal === "APPROVED") return "ACCEPTED";
  if (terminal === "REJECTED") return "IN_PROGRESS";
  return null;
}

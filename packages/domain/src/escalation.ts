/**
 * Approval escalation rules. A package still awaiting a decision N hours
 * after sending is escalated exactly once: either the undecided approvers
 * get a second nudge, or the agency leads are told the package is stalled.
 */

export const ESCALATION_TARGETS = ["SECOND_APPROVER", "AGENCY_LEAD"] as const;
export type EscalationTarget = (typeof ESCALATION_TARGETS)[number];

export interface EscalationSettings {
  afterHours: number | null;
  target: EscalationTarget;
}

/** Validated escalation delay: 1–720 hours, or null when disabled. */
export function escalationAfterHours(settings: { escalation?: { afterHours?: number | null } | null }): number | null {
  const hours = settings.escalation?.afterHours ?? null;
  return typeof hours === "number" && Number.isInteger(hours) && hours >= 1 && hours <= 720 ? hours : null;
}

export function escalationTarget(settings: { escalation?: { target?: string } | null }): EscalationTarget {
  const target = settings.escalation?.target;
  return target === "SECOND_APPROVER" || target === "AGENCY_LEAD" ? target : "AGENCY_LEAD";
}

/** A SENT, never-escalated package past its project's delay is due. */
export function isEscalationDue(args: {
  status: string;
  escalatedAt: string | null;
  sentAt: string | null;
  nowIso: string;
  settings: { escalation?: { afterHours?: number | null } | null };
}): boolean {
  if (args.status !== "SENT" || args.escalatedAt !== null || args.sentAt === null) return false;
  const afterHours = escalationAfterHours(args.settings);
  if (afterHours === null) return false;
  return (Date.parse(args.nowIso) - Date.parse(args.sentAt)) / 3_600_000 >= afterHours;
}

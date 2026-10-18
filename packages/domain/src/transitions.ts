import { DomainError } from "./errors.js";
import type {
  ApprovalStatus,
  BundleStatus,
  ChangeStatus,
  ProjectStatus,
  RequirementStatus,
  ScopeVersionStatus,
} from "./enums.js";

function buildMap<T extends string>(pairs: Array<[T, T[]]>): Record<T, T[]> {
  return Object.fromEntries(pairs) as Record<T, T[]>;
}

export const ChangeTransitions = buildMap<ChangeStatus>([
  ["DRAFT", ["SUBMITTED", "PARKED", "WITHDRAWN"]],
  ["SUBMITTED", ["TRIAGING", "NEEDS_CLARIFICATION", "PARKED", "WITHDRAWN"]],
  ["TRIAGING", ["NEEDS_CLARIFICATION", "ESTIMATING", "PARKED", "WITHDRAWN", "SUBMITTED"]],
  ["NEEDS_CLARIFICATION", ["TRIAGING", "ESTIMATING", "PARKED", "WITHDRAWN"]],
  ["ESTIMATING", ["PENDING_APPROVAL", "NEEDS_CLARIFICATION", "PARKED", "WITHDRAWN", "TRIAGING"]],
  // APPROVED/REJECTED are reachable only through a recorded approval decision.
  // PENDING_APPROVAL cannot park: resolve or invalidate the live package first.
  ["PENDING_APPROVAL", ["APPROVED", "REJECTED", "ESTIMATING", "NEEDS_CLARIFICATION", "WITHDRAWN"]],
  ["APPROVED", ["IMPLEMENTED", "WITHDRAWN"]],
  ["REJECTED", ["ESTIMATING", "PARKED", "WITHDRAWN"]],
  ["PARKED", ["DRAFT", "SUBMITTED", "WITHDRAWN"]],
  ["WITHDRAWN", ["DRAFT"]],
  ["IMPLEMENTED", []],
]);

/** Statuses a human PATCH may set directly (decision-driven ones are excluded). */
export const ManualChangeTransitions: ChangeStatus[] = [
  "DRAFT",
  "SUBMITTED",
  "TRIAGING",
  "NEEDS_CLARIFICATION",
  "ESTIMATING",
  "PARKED",
  "WITHDRAWN",
];

export const RequirementTransitions = buildMap<RequirementStatus>([
  ["PROPOSED", ["AGREED", "OUT_OF_SCOPE"]],
  ["AGREED", ["IN_PROGRESS", "OUT_OF_SCOPE"]],
  ["IN_PROGRESS", ["DELIVERED", "OUT_OF_SCOPE"]],
  ["DELIVERED", ["ACCEPTED", "IN_PROGRESS"]],
  ["ACCEPTED", []],
  ["OUT_OF_SCOPE", ["PROPOSED"]],
]);

export const ApprovalTransitions = buildMap<ApprovalStatus>([
  ["DRAFT", ["SENT", "INVALIDATED"]],
  ["SENT", ["DECIDED", "EXPIRED", "INVALIDATED", "DEEMED"]],
  ["DECIDED", []],
  ["EXPIRED", ["SENT"]],
  ["INVALIDATED", ["SENT"]],
  ["DEEMED", []],
]);

export const ScopeVersionTransitions = buildMap<ScopeVersionStatus>([
  ["DRAFT", ["PUBLISHED"]],
  ["PUBLISHED", ["SUPERSEDED"]],
  ["SUPERSEDED", []],
]);

export const ProjectTransitions = buildMap<ProjectStatus>([
  ["DRAFT", ["ACTIVE", "ARCHIVED"]],
  ["ACTIVE", ["PAUSED", "COMPLETED", "ARCHIVED"]],
  ["PAUSED", ["ACTIVE", "ARCHIVED"]],
  ["COMPLETED", ["ARCHIVED", "ACTIVE"]],
  ["ARCHIVED", ["ACTIVE"]],
]);

export const BundleTransitions = buildMap<BundleStatus>([
  ["DRAFT", ["PENDING_APPROVAL", "REJECTED"]],
  ["PENDING_APPROVAL", ["APPROVED", "REJECTED", "DRAFT"]],
  ["APPROVED", []],
  ["REJECTED", ["DRAFT"]],
]);

export function assertTransition<T extends string>(
  map: Record<T, T[]>,
  from: T,
  to: T,
  entity: string,
): void {
  if (from === to) return;
  const allowed = map[from] ?? [];
  if (!allowed.includes(to)) {
    throw DomainError.conflict(`Invalid ${entity} transition: ${from} → ${to}`, {
      from,
      to,
      allowed,
    });
  }
}

export function assertManualChangeTransition(from: ChangeStatus, to: ChangeStatus): void {
  if (!ManualChangeTransitions.includes(to)) {
    throw DomainError.unprocessable(
      `Status ${to} can only be reached through an approval decision or implementation step`,
      { to },
    );
  }
  assertTransition(ChangeTransitions, from, to, "change request");
}

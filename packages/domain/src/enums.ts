// Core domain enums shared by API, contracts, and storage layers.

export const OrgRoles = ["OWNER", "ADMIN", "MEMBER", "CLIENT"] as const;
export type OrgRole = (typeof OrgRoles)[number];

export const ProjectRoles = [
  "LEAD",
  "MEMBER",
  "CLIENT_ADMIN",
  "CLIENT_APPROVER",
  "CLIENT_VIEWER",
] as const;
export type ProjectRole = (typeof ProjectRoles)[number];

export const ProjectStatuses = ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"] as const;
export type ProjectStatus = (typeof ProjectStatuses)[number];

export const ScopeVersionStatuses = ["DRAFT", "PUBLISHED", "SUPERSEDED"] as const;
export type ScopeVersionStatus = (typeof ScopeVersionStatuses)[number];

export const RequirementStatuses = [
  "PROPOSED",
  "AGREED",
  "IN_PROGRESS",
  "DELIVERED",
  "ACCEPTED",
  "OUT_OF_SCOPE",
] as const;
export type RequirementStatus = (typeof RequirementStatuses)[number];

export const ChangeStatuses = [
  "DRAFT",
  "SUBMITTED",
  "TRIAGING",
  "NEEDS_CLARIFICATION",
  "ESTIMATING",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "PARKED",
  "WITHDRAWN",
  "IMPLEMENTED",
] as const;
export type ChangeStatus = (typeof ChangeStatuses)[number];

export const ChangeClassifications = [
  "IN_SCOPE",
  "POTENTIAL_CHANGE",
  "DUPLICATE",
  "NEEDS_CLARIFICATION",
] as const;
export type ChangeClassification = (typeof ChangeClassifications)[number];

export const ApprovalStatuses = ["DRAFT", "SENT", "DECIDED", "EXPIRED", "INVALIDATED", "DEEMED"] as const;
export type ApprovalStatus = (typeof ApprovalStatuses)[number];

export const ApprovalDecisions = ["APPROVED", "REJECTED", "CHANGES_REQUESTED"] as const;
export type ApprovalDecision = (typeof ApprovalDecisions)[number];

export const LinkKinds = ["AFFECTS", "DUPLICATE_OF", "RELATED", "DEPENDS_ON"] as const;
export type LinkKind = (typeof LinkKinds)[number];

export const LinkConditions = ["PREREQ_APPROVED", "PREREQ_IMPLEMENTED"] as const;
export type LinkCondition = (typeof LinkConditions)[number];

export const EvidenceTypes = ["URL", "FILE", "NOTE", "TEST_RESULT"] as const;
export type EvidenceType = (typeof EvidenceTypes)[number];

export const EvidenceStatuses = ["PENDING", "REVIEWED", "ACCEPTED"] as const;
export type EvidenceStatus = (typeof EvidenceStatuses)[number];

export const AttachmentStatuses = ["PENDING", "READY", "QUARANTINED", "DELETED"] as const;
export type AttachmentStatus = (typeof AttachmentStatuses)[number];

export const ConfidenceLevels = ["LOW", "MEDIUM", "HIGH"] as const;
export type ConfidenceLevel = (typeof ConfidenceLevels)[number];

export const BundleStatuses = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED"] as const;
export type BundleStatus = (typeof BundleStatuses)[number];

export const AIKinds = ["EXTRACT", "DRIFT", "CLARIFY", "PROPOSAL", "MEMORY", "COMPARE", "IMPORT"] as const;
export type AIKind = (typeof AIKinds)[number];

export const AIStatuses = ["PENDING", "SUCCEEDED", "FAILED", "FALLBACK"] as const;
export type AIStatus = (typeof AIStatuses)[number];

export const Plans = ["FREE", "PRO", "SCALE"] as const;
export type Plan = (typeof Plans)[number];

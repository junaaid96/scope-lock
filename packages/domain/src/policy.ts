import type { OrgRole, ProjectRole } from "./enums.js";

/** All protected actions in the system. Every API mutation checks one of these. */
export type Action =
  | "org.view"
  | "org.manage"
  | "org.invite"
  | "org.members.manage"
  | "org.usage.view"
  | "org.branding.manage"
  | "client.manage"
  | "project.create"
  | "project.view"
  | "project.manage"
  | "project.members.manage"
  | "scope.view"
  | "scope.draft"
  | "scope.publish"
  | "requirement.status"
  | "change.submit"
  | "acceptance.send"
  | "change.triage"
  | "change.estimate"
  | "change.send"
  | "change.implement"
  | "change.convert"
  | "approval.view"
  | "approval.decide"
  | "bundle.manage"
  | "note.create"
  | "evidence.attach"
  | "evidence.verify"
  | "file.upload"
  | "file.download"
  | "ai.use"
  | "ai.review"
  | "activity.view"
  | "health.view"
  | "export.read"
  | "external.manage"
  | "ratecard.view"
  | "ratecard.manage"
  | "allowance.manage"
  | "allowance.object"
  | "intake.manage"
  | "notifications.view";

export interface AccessContext {
  orgRole: OrgRole | null;
  projectRole: ProjectRole | null;
  /** True when the actor is an explicitly assigned approver of the package under review. */
  isAssignedApprover?: boolean;
}

const ORG_WIDE_PROJECT_ACCESS: OrgRole[] = ["OWNER", "ADMIN"];

function isOrgOperator(ctx: AccessContext): boolean {
  return ctx.orgRole !== null && ORG_WIDE_PROJECT_ACCESS.includes(ctx.orgRole);
}

function isAgencyProjectActor(ctx: AccessContext): boolean {
  return (
    isOrgOperator(ctx) || ctx.projectRole === "LEAD" || ctx.projectRole === "MEMBER"
  );
}

function isProjectLead(ctx: AccessContext): boolean {
  return isOrgOperator(ctx) || ctx.projectRole === "LEAD";
}

/**
 * Pure authorization check. Agency OWNER/ADMIN act as project leads on every
 * organization project; everyone else needs an explicit project membership.
 */
export function can(ctx: AccessContext, action: Action): boolean {
  if (ctx.orgRole === null) return false;
  switch (action) {
    case "org.view":
      return true;
    case "org.manage":
    case "org.members.manage":
    case "org.branding.manage":
      return ctx.orgRole === "OWNER" || ctx.orgRole === "ADMIN";
    case "org.invite":
    case "project.create":
    case "client.manage":
      return ctx.orgRole === "OWNER" || ctx.orgRole === "ADMIN" || ctx.orgRole === "MEMBER";
    case "org.usage.view":
    case "ratecard.manage":
      return ctx.orgRole === "OWNER" || ctx.orgRole === "ADMIN";
    case "ratecard.view":
      // Org commercial data: agency staff only, never client org roles.
      return ctx.orgRole === "OWNER" || ctx.orgRole === "ADMIN" || ctx.orgRole === "MEMBER";
    case "allowance.manage":
      // Per-project commercial control: agency leads (operators included).
      return isOrgOperator(ctx) || ctx.projectRole === "LEAD";
    case "allowance.object":
      // The client's check on draw-downs: client approvers only.
      return ctx.projectRole === "CLIENT_ADMIN" || ctx.projectRole === "CLIENT_APPROVER";
    case "project.view":
    case "scope.view":
    case "activity.view":
    case "health.view":
    case "notifications.view":
      return isOrgOperator(ctx) || ctx.projectRole !== null;
    case "project.manage":
    case "project.members.manage":
    case "scope.draft":
    case "scope.publish":
    case "requirement.status":
    case "change.triage":
    case "change.estimate":
    case "acceptance.send":
    case "change.send":
    case "change.implement":
    case "change.convert":
    case "bundle.manage":
    case "evidence.verify":
    case "external.manage":
    case "intake.manage":
      return isProjectLead(ctx);
    case "change.submit":
    case "file.upload":
    case "note.create":
    case "evidence.attach":
      return (
        isAgencyProjectActor(ctx) ||
        ctx.projectRole === "CLIENT_ADMIN" ||
        ctx.projectRole === "CLIENT_APPROVER"
      );
    case "file.download":
    case "approval.view":
    case "export.read":
      return isOrgOperator(ctx) || ctx.projectRole !== null;
    case "approval.decide":
      return (
        ctx.isAssignedApprover === true &&
        (isOrgOperator(ctx) || ctx.projectRole !== null)
      );
    case "ai.use":
    case "ai.review":
      return isAgencyProjectActor(ctx);
    default:
      return false;
  }
}

/** Client roles may never perform agency-side workflow steps even if assigned as approvers. */
export function isClientSide(ctx: AccessContext): boolean {
  if (isOrgOperator(ctx)) return false;
  return (
    ctx.orgRole === "CLIENT" ||
    ctx.projectRole === "CLIENT_ADMIN" ||
    ctx.projectRole === "CLIENT_APPROVER" ||
    ctx.projectRole === "CLIENT_VIEWER"
  );
}

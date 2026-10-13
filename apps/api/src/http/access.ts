import { DomainError, can, type AccessContext, type Action } from "@scopelock/domain";
import type { Store, Organization, Project, ProjectMember, Membership } from "../store/index.js";

export interface OrgAccess {
  org: Organization;
  membership: Membership;
}

export interface ProjectAccess extends OrgAccess {
  project: Project;
  projectMember: ProjectMember | null;
  access: AccessContext;
}

/** Membership in the org, or 404 (never disclose org existence to outsiders). */
export async function requireOrgAccess(store: Store, userId: string, orgId: string): Promise<OrgAccess> {
  const org = await store.findOrganizationById(orgId);
  if (!org) throw DomainError.notFound("Organization not found");
  const membership = await store.findMembership(orgId, userId);
  if (!membership) throw DomainError.notFound("Organization not found");
  return { org, membership };
}

/** Project visibility: org membership + (org OWNER/ADMIN or explicit project role). */
export async function requireProjectAccess(
  store: Store,
  userId: string,
  projectId: string,
): Promise<ProjectAccess> {
  const project = await store.findProjectById(projectId);
  if (!project) throw DomainError.notFound("Project not found");
  const { org, membership } = await requireOrgAccess(store, userId, project.organizationId);
  const projectMember = await store.findProjectMember(projectId, userId);
  const access: AccessContext = {
    orgRole: membership.role,
    projectRole: projectMember?.role ?? null,
  };
  const isOrgOperator = membership.role === "OWNER" || membership.role === "ADMIN";
  if (!isOrgOperator && !projectMember) throw DomainError.notFound("Project not found");
  return { org, membership, project, projectMember, access };
}

/** Enforce a policy action (403 when the role lacks the permission). */
export function requireAction(access: AccessContext, action: Action): void {
  if (!can(access, action)) {
    throw DomainError.forbidden(`Your role does not allow: ${action}`, { action });
  }
}

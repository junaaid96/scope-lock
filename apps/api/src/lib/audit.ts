import { getContext } from "../context.js";
import type { Store } from "../store/index.js";

export interface AuditInput {
  organizationId: string;
  projectId?: string | null;
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
}

/**
 * User-level audit write (login methods, MFA): filed under the user's first
 * org, skipped for org-less users (same convention as mfa.enabled).
 */
export async function auditUser(
  store: Store,
  userId: string,
  actorEmail: string,
  action: string,
  before?: unknown,
  after?: unknown,
): Promise<void> {
  const orgId = (await store.listOrganizationsForUser(userId))[0]?.id;
  if (!orgId) return;
  await audit(store, {
    organizationId: orgId,
    projectId: null,
    actorId: userId,
    actorEmail,
    action,
    targetType: "USER",
    targetId: userId,
    before,
    after,
  });
}

/** Append-only audit write. Every state transition records actor/time/before/after. */
export async function audit(store: Store, input: AuditInput): Promise<void> {
  const ctx = getContext();
  await store.appendAuditEvent({
    organizationId: input.organizationId,
    projectId: input.projectId ?? null,
    actorId: input.actorId ?? ctx?.userId ?? null,
    actorEmail: input.actorEmail ?? null,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    before: input.before,
    after: input.after,
    correlationId: ctx?.correlationId ?? "no-correlation",
    ip: ctx?.ip ?? null,
  });
}

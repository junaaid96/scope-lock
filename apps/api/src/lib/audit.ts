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

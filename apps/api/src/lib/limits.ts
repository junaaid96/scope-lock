import { DomainError } from "@scopelock/domain";
import type { Plan } from "@scopelock/domain";
import type { Store } from "../store/index.js";
import { currentPeriod } from "../store/index.js";

/** Plan limits. Exceeding a limit fails gracefully with a 422 + upgrade hint. */
export const PLAN_LIMITS: Record<
  Plan,
  { projects: number; aiCallsPerMonth: number; storageBytes: number; uploadsBytes: number }
> = {
  FREE: { projects: 3, aiCallsPerMonth: 50, storageBytes: 500 * 1024 * 1024, uploadsBytes: 10 * 1024 * 1024 },
  PRO: { projects: 50, aiCallsPerMonth: 2000, storageBytes: 50 * 1024 * 1024 * 1024, uploadsBytes: 100 * 1024 * 1024 },
  SCALE: {
    projects: Number.MAX_SAFE_INTEGER,
    aiCallsPerMonth: Number.MAX_SAFE_INTEGER,
    storageBytes: Number.MAX_SAFE_INTEGER,
    uploadsBytes: 100 * 1024 * 1024,
  },
};

export async function assertProjectQuota(store: Store, organizationId: string, plan: Plan): Promise<void> {
  const limit = PLAN_LIMITS[plan].projects;
  const projects = await store.listProjects(organizationId);
  if (projects.length >= limit) {
    throw DomainError.unprocessable(`Project limit reached for the ${plan} plan (${limit}).`, {
      code: "LIMIT_EXCEEDED",
      limit,
      plan,
    });
  }
}

export async function assertAiQuota(store: Store, organizationId: string, plan: Plan): Promise<void> {
  const limit = PLAN_LIMITS[plan].aiCallsPerMonth;
  const usage = await store.getUsage(organizationId, currentPeriod());
  if (usage.aiCalls >= limit) {
    throw DomainError.unprocessable(`Monthly AI allowance reached for the ${plan} plan (${limit} calls).`, {
      code: "AI_QUOTA_EXCEEDED",
      limit,
      plan,
    });
  }
}

export async function assertStorageQuota(
  store: Store,
  organizationId: string,
  plan: Plan,
  additionalBytes: number,
): Promise<void> {
  const usage = await store.getUsage(organizationId, currentPeriod());
  const limit = PLAN_LIMITS[plan].storageBytes;
  if (usage.storageBytes + additionalBytes > limit) {
    throw DomainError.unprocessable(`Storage limit reached for the ${plan} plan.`, {
      code: "LIMIT_EXCEEDED",
      limit,
      plan,
    });
  }
  const perFile = PLAN_LIMITS[plan].uploadsBytes;
  if (additionalBytes > perFile) {
    throw DomainError.unprocessable(`File exceeds the per-file limit (${perFile} bytes) for the ${plan} plan.`, {
      code: "LIMIT_EXCEEDED",
      limit: perFile,
      plan,
    });
  }
}

import { describe, expect, it } from "vitest";
import { verifyAuditChain } from "@scopelock/domain";
import { PrismaStore } from "../src/store/prisma-store.js";

const URL = process.env.TEST_DATABASE_URL ?? "";

/**
 * Postgres chain concurrency: proves the head-row lock serializes writers so
 * concurrent appends form one fork-free chain. Runs in CI against a service
 * database; skipped locally unless TEST_DATABASE_URL is set.
 */
describe("audit chain postgres concurrency", () => {
  it("serializes concurrent appends into one chain", async () => {
    if (!URL) {
      console.log("SKIP: set TEST_DATABASE_URL to run the postgres chain concurrency test");
      return;
    }
    const store = await PrismaStore.connect(URL);
    try {
      const stamp = Date.now();
      const org = await store.createOrganization({ name: `Chain Org ${stamp}` });
      const client = await store.createClient({ organizationId: org.id, name: "Chain Client", company: null, contacts: [], notes: null });
      const project = await store.createProject({
        organizationId: org.id,
        clientId: client.id,
        name: `Chain Project ${stamp}`,
        currency: "USD",
        budgetMinor: null,
        startDate: null,
        targetDate: null,
        settings: { aiEnabled: true, reminderHoursBeforeExpiry: [48, 24], approvalPolicies: [], stepUp: { otp: null, typedName: null }, deemedAcceptanceDays: null, escalation: { afterHours: null, target: "AGENCY_LEAD" }, defaultLocale: null },
      });
      const N = 20;
      await Promise.all(
        Array.from({ length: N }, (_, i) =>
          store.appendAuditEvent({
            organizationId: org.id,
            projectId: project.id,
            actorId: null,
            actorEmail: null,
            action: `test.concurrent.${i}`,
            targetType: "PROJECT",
            targetId: project.id,
            correlationId: `chain-conc-${stamp}-${i}`,
            ip: null,
          }),
        ),
      );
      const events = await store.listAuditChain(`project:${project.id}`);
      expect(events).toHaveLength(N);
      expect(events.map((e) => e.chainSeq)).toEqual(Array.from({ length: N }, (_, i) => i + 1));
      expect(verifyAuditChain(events)).toMatchObject({ valid: true, checked: N, legacy: 0 });
      const head = await store.getAuditChainHead(`project:${project.id}`);
      expect(head?.eventCount).toBe(N);
      expect(head?.headHash).toBe(events[N - 1]?.hash);
    } finally {
      await store.disconnect();
    }
  }, 60_000);
});

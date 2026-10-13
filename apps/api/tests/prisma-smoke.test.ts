import { describe, expect, it } from "vitest";
import { PrismaStore } from "../src/store/prisma-store.js";

const URL = process.env.TEST_DATABASE_URL ?? "";

/**
 * Postgres smoke test: proves the committed migrations apply cleanly and the
 * PrismaStore round-trips core records. Runs in CI against a service database;
 * skipped locally unless TEST_DATABASE_URL is set.
 */
describe("prisma postgres smoke", () => {
  it("migrates and round-trips core records", async () => {
    if (!URL) {
      console.log("SKIP: set TEST_DATABASE_URL to run the postgres smoke test");
      return;
    }
    const store = await PrismaStore.connect(URL);
    try {
      const email = `smoke-${Date.now()}@test.dev`;
      const user = await store.createUser({ email, name: "Smoke", passwordHash: "x" });
      expect(user.mfaEnabled).toBe(false);
      const org = await store.createOrganization({ name: "Smoke Org" });
      await store.upsertMembership(org.id, user.id, "OWNER");
      const client = await store.createClient({ organizationId: org.id, name: "Smoke Client", company: null, contacts: [], notes: null });
      const project = await store.createProject({
        organizationId: org.id,
        clientId: client.id,
        name: "Smoke Project",
        currency: "USD",
        budgetMinor: null,
        startDate: null,
        targetDate: null,
        settings: { aiEnabled: true, reminderHoursBeforeExpiry: [48, 24] },
      });
      expect((await store.findProjectById(project.id))?.name).toBe("Smoke Project");
      const doc = await store.createScopeDocument(project.id, "Scope");
      const version = await store.createScopeVersion({
        scopeDocumentId: doc.id,
        projectId: project.id,
        status: "DRAFT",
        title: "v1",
        summary: null,
        assumptions: [],
        exclusions: [],
        version: 0,
        publishedAt: null,
        publishedBy: null,
        createdBy: user.id,
        supersedesId: null,
      });
      expect(version.sequence).toBe(1);
      const change = await store.createChange({
        projectId: project.id,
        title: "Smoke change",
        description: "desc",
        source: "AGENCY",
        status: "DRAFT",
        classification: null,
        classificationRationale: null,
        submitterId: user.id,
        bundleId: null,
        amendmentVersionId: null,
      });
      expect(change.number).toBe("CHG-001");
      // MFA columns from migration 0002 round-trip.
      const updated = await store.updateUser(user.id, { mfaEnabled: true, mfaRecoveryHashes: ["abc"] });
      expect(updated.mfaEnabled).toBe(true);
      expect(updated.mfaRecoveryHashes).toEqual(["abc"]);
    } finally {
      await store.disconnect();
    }
  });
});

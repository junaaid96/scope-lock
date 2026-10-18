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
        drawAllowancePoolId: null,
      });
      expect(change.number).toBe("CHG-001");
      // MFA columns from migration 0002 round-trip.
      const updated = await store.updateUser(user.id, { mfaEnabled: true, mfaRecoveryHashes: ["abc"] });
      expect(updated.mfaEnabled).toBe(true);
      expect(updated.mfaRecoveryHashes).toEqual(["abc"]);
      // Rate cards, templates, and priced impacts from migration 0004.
      const card = await store.createRateCard({
        organizationId: org.id,
        name: "Smoke Card",
        currency: "USD",
        isDefault: true,
        createdBy: user.id,
        rates: [{ role: "Senior Engineer", hourlyRateMinor: 8000 }],
      });
      expect((await store.findRateCardById(card.id))?.rates).toHaveLength(1);
      expect(await store.listRateCards(org.id)).toHaveLength(1);
      const renamed = await store.updateRateCard(card.id, { name: "Smoke Card v2" });
      expect(renamed.name).toBe("Smoke Card v2");
      const template = await store.createEstimateTemplate({
        organizationId: org.id,
        name: "Smoke Template",
        items: [{ label: "Build", role: "Senior Engineer", hours: 10 }],
        contingencyPct: 10,
        taxPct: 5,
        createdBy: user.id,
      });
      expect((await store.listEstimateTemplates(org.id)).map((tpl) => tpl.name)).toEqual(["Smoke Template"]);
      const impact = await store.createImpact({
        changeRequestId: change.id,
        effortDays: 2,
        priceMinor: 115500,
        currency: "USD",
        timelineDays: null,
        milestoneEffect: null,
        risks: [],
        exclusions: [],
        notes: null,
        confidence: "HIGH",
        rateCardId: card.id,
        templateId: template.id,
        pricing: {
          mode: "COMPUTED",
          rateCardId: card.id,
          rateCardName: card.name,
          templateId: template.id,
          templateName: template.name,
          currency: "USD",
          lines: [{ label: "Build", role: "Senior Engineer", hours: 10, hourlyRateMinor: 8000, lineMinor: 80000 }],
          subtotalMinor: 80000,
          contingencyPct: 10,
          contingencyMinor: 8000,
          taxPct: 5,
          taxMinor: 4400,
          computedMinor: 92400,
        },
        overrideReason: null,
        createdBy: user.id,
      });
      expect(impact.pricing?.computedMinor).toBe(92400);
      expect((await store.findLatestImpact(change.id))?.overrideReason).toBeNull();
      expect(await store.countImpactsByRateCard(card.id)).toBe(1);
      await store.deleteEstimateTemplate(template.id);
      expect(await store.listEstimateTemplates(org.id)).toHaveLength(0);
      // Allowance pools + draw-downs from migration 0005.
      const pool = await store.createAllowancePool({
        projectId: project.id,
        name: "Smoke Pool",
        kind: "AMOUNT",
        totalHours: null,
        totalMinor: 100000,
        currency: "USD",
        objectionWindowHours: 72,
        enabled: true,
        createdBy: user.id,
      });
      expect(pool.status).toBe("PROPOSED");
      expect((await store.findAllowancePoolById(pool.id))?.name).toBe("Smoke Pool");
      expect(await store.listAllowancePools(project.id)).toHaveLength(1);
      const active = await store.updateAllowancePool(pool.id, { status: "ACTIVE" });
      expect(active.enabled).toBe(true);
      await store.touchAllowancePool(pool.id);
      const draw = await store.createDrawDown({
        poolId: pool.id,
        changeRequestId: change.id,
        hours: null,
        amountMinor: 25000,
        notifiedAt: new Date().toISOString(),
        objectionDeadline: new Date(Date.now() + 72 * 3600_000).toISOString(),
      });
      expect(draw.status).toBe("NOTIFIED");
      expect((await store.findDrawDownByChange(change.id))?.id).toBe(draw.id);
      expect(await store.listDrawDownsByPool(pool.id)).toHaveLength(1);
      const objected = await store.updateDrawDown(draw.id, { status: "OBJECTED", objectionReason: "too much" });
      expect(objected.objectionReason).toBe("too much");
      // Roll back: a failed transaction leaves no pool behind.
      await expect(
        store.transaction(async (tx) => {
          await tx.createAllowancePool({
            projectId: project.id,
            name: "Doomed Pool",
            kind: "HOURS",
            totalHours: 5,
            totalMinor: null,
            currency: null,
            objectionWindowHours: 24,
            enabled: false,
            createdBy: user.id,
          });
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      expect((await store.listAllowancePools(project.id)).map((p) => p.name)).toEqual(["Smoke Pool"]);
      // AI usage log from migration 0006 records the serving provider.
      const analysis = await store.createAIAnalysis({
        projectId: project.id,
        changeRequestId: null,
        kind: "CLARIFY",
        inputRefs: {},
        provider: "openai",
        model: "stub-model",
        promptVersion: "v-test",
        output: {},
        status: "SUCCEEDED",
        usage: null,
        latencyMs: 12,
        error: null,
        reviewerDisposition: null,
        reviewedBy: null,
        createdBy: user.id,
      });
      expect((await store.findAIAnalysisById(analysis.id))?.provider).toBe("openai");
      // Roll back: a failed transaction leaves no card behind.
      await expect(
        store.transaction(async (tx) => {
          await tx.createRateCard({ organizationId: org.id, name: "Doomed", currency: "USD", isDefault: false, createdBy: user.id, rates: [] });
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      expect((await store.listRateCards(org.id)).map((c) => c.name)).toEqual(["Smoke Card v2"]);
    } finally {
      await store.disconnect();
    }
  });
});

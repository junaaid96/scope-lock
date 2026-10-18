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
        settings: { aiEnabled: true, reminderHoursBeforeExpiry: [48, 24], approvalPolicies: [], stepUp: { otp: null, typedName: null }, deemedAcceptanceDays: null, escalation: { afterHours: null, target: "AGENCY_LEAD" } },
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
        submitterName: null,
        submitterEmail: null,
        unverifiedSubmitter: false,
        scopeCheckSuggestedIds: [],
        bundleId: null,
        amendmentVersionId: null,
        drawAllowancePoolId: null,
      });
      expect(change.number).toBe("CHG-001");
      expect(change.scopeCheckSuggestedIds).toEqual([]);
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
        actualEffortDays: null,
        actualPriceMinor: null,
        actualNotes: null,
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
      const withActuals = await store.recordActuals(change.id, {
        actualEffortDays: 3,
        actualPriceMinor: 120000,
        actualNotes: "Took a day longer than estimated",
      });
      expect(withActuals.actualPriceMinor).toBe(120000);
      expect((await store.findLatestImpact(change.id))?.actualEffortDays).toBe(3);
      expect(await store.countImpactsByRateCard(card.id)).toBe(1);
      await store.deleteEstimateTemplate(template.id);
      expect(await store.listEstimateTemplates(org.id)).toHaveLength(0);
      // Scope templates (migration 0022) round-trip with JSON content.
      const scopeTpl = await store.createScopeTemplate({
        organizationId: org.id,
        name: "Smoke Website",
        projectType: "Website",
        description: null,
        assumptions: ["Client provides copy"],
        exclusions: ["Native apps"],
        items: [{ title: "Home", description: "Landing page", acceptanceCriteria: ["Loads fast"], category: null, priority: "HIGH" }],
        createdBy: user.id,
      });
      expect((await store.listScopeTemplates(org.id)).map((t) => t.name)).toEqual(["Smoke Website"]);
      const renamedTpl = await store.updateScopeTemplate(scopeTpl.id, { name: "Smoke Website v2" });
      expect(renamedTpl.name).toBe("Smoke Website v2");
      await store.deleteScopeTemplate(scopeTpl.id);
      expect(await store.listScopeTemplates(org.id)).toHaveLength(0);
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
      // Intake links from migration 0007.
      const intakeHash = `hash-smoke-intake-${Date.now()}`;
      const intake = await store.createIntakeLink({
        projectId: project.id,
        name: "Smoke form",
        tokenHash: intakeHash,
        expiresAt: null,
        createdBy: user.id,
      });
      expect((await store.findIntakeLinkByHash(intakeHash))?.id).toBe(intake.id);
      expect(await store.listIntakeLinks(project.id)).toHaveLength(1);
      const revoked = await store.updateIntakeLink(intake.id, { revokedAt: new Date().toISOString(), submissions: 3 });
      expect(revoked.submissions).toBe(3);
      expect(revoked.revokedAt).not.toBeNull();
      // Inbound mailboxes from migration 0009.
      const mailbox = await store.createInboundMailbox({
        projectId: project.id,
        name: "Smoke box",
        localPart: `chg-smoke-${Date.now()}`,
        createdBy: user.id,
      });
      expect((await store.findInboundMailboxByLocalPart(mailbox.localPart))?.id).toBe(mailbox.id);
      expect(await store.listInboundMailboxes(project.id)).toHaveLength(1);
      await store.deleteInboundMailbox(mailbox.id);
      expect(await store.listInboundMailboxes(project.id)).toHaveLength(0);
      // Proposal options + PARKED from migration 0012.
      const optA = await store.createOption({
        changeRequestId: change.id,
        label: "Full",
        description: null,
        effortDays: 5,
        priceMinor: 200000,
        currency: "USD",
        timelineDays: 7,
        milestoneEffect: null,
        risks: [],
        exclusions: [],
        notes: null,
        createdBy: user.id,
      });
      expect((await store.findOptionById(optA.id))?.label).toBe("Full");
      expect(await store.listOptionsByChange(change.id)).toHaveLength(1);
      const optB = await store.updateOption(optA.id, { label: "Full scope", version: 1 });
      expect(optB.label).toBe("Full scope");
      await store.deleteOption(optA.id);
      expect(await store.listOptionsByChange(change.id)).toHaveLength(0);
      const parked = await store.updateChange(change.id, { status: "PARKED" });
      expect(parked.status).toBe("PARKED");
      // Approval policy (0011) + chosen option (0012) columns round-trip.
      const approval = await store.createApproval({
        projectId: project.id,
        changeRequestId: change.id,
        bundleId: null,
        allowancePoolId: null,
        title: "Smoke approval",
        package: {
          title: "Smoke approval",
          changeId: change.id,
          bundleId: null,
          request: null,
          members: [],
          impact: null,
          options: [],
          requirements: [],
          attachments: [],
          assumptions: [],
          exclusions: [],
          sentAt: new Date().toISOString(),
        },
        checksum: "smoke",
        status: "SENT",
        approverUserIds: [],
        policy: { mode: "ALL", approverOrder: [] },
        expiresAt: null,
        sentAt: null,
        sentBy: null,
        createdBy: user.id,
        invalidatedReason: null,
        supersededBy: null,
        remindersSent: [],
        chosenOptionId: null,
        acceptanceRequirementIds: [],
        deemedAt: null,
        escalatedAt: null,
        version: 0,
      });
      expect(approval.policy.mode).toBe("ALL");
      const decided = await store.updateApproval(approval.id, { status: "DECIDED", chosenOptionId: optA.id });
      expect(decided.chosenOptionId).toBe(optA.id);
      const vote = await store.createDecision({
        approvalRequestId: approval.id,
        approverUserId: null,
        approverEmail: "smoke@test.dev",
        tokenId: null,
        decision: "APPROVED",
        comment: null,
        optionId: optA.id,
        typedName: "Smoke Signer",
        checksum: "smoke",
        ip: null,
        userAgent: null,
      });
      expect((await store.listDecisions(approval.id))[0]?.optionId).toBe(optA.id);
      expect(vote.decision).toBe("APPROVED");
      // Step-up challenges from migration 0013 round-trip, hashed.
      const challenge = await store.createStepUpChallenge({
        approvalRequestId: approval.id,
        tokenId: null,
        approverKey: user.id,
        codeHash: "smoke-hash",
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        maxAttempts: 5,
      });
      expect(challenge.attempts).toBe(0);
      expect(await store.listStepUpChallenges(approval.id)).toHaveLength(1);
      const consumed = await store.updateStepUpChallenge(challenge.id, { attempts: 1, consumedAt: new Date().toISOString() });
      expect(consumed.consumedAt).not.toBeNull();
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

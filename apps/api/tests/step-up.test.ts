import { describe, expect, it } from "vitest";
import request from "supertest";
import { agencyFixture, createTestApp, type Agent } from "./helpers.js";
import type { MemoryStore } from "../src/store/memory.js";

const EXPIRY = (): string => new Date(Date.now() + 7 * 86_400_000).toISOString();

async function sendableChange(agent: Agent, projectId: string, priceMinor: number): Promise<string> {
  const created = await agent.post(`/api/v1/projects/${projectId}/change-requests`).send({
    title: "Step-up probe",
    description: "Step-up probe description",
    source: "AGENCY",
  });
  expect(created.status).toBe(201);
  const id = created.body.id as string;
  let v = created.body.version as number;
  for (const status of ["SUBMITTED", "TRIAGING", "ESTIMATING"]) {
    const res = await agent.patch(`/api/v1/change-requests/${id}`).send({
      expectedVersion: v,
      status,
      ...(status === "TRIAGING" ? { classification: "POTENTIAL_CHANGE", classificationRationale: "New work" } : {}),
    });
    expect(res.status).toBe(200);
    v = res.body.version as number;
  }
  const impact = await agent.post(`/api/v1/change-requests/${id}/impact`).send({
    effortDays: 2,
    priceMinor,
    timelineDays: 3,
    confidence: "HIGH",
  });
  expect(impact.status).toBe(201);
  return id;
}

/** The latest emailed code, read from the undrained test outbox. */
async function emailedCode(store: MemoryStore): Promise<string> {
  const batch = await store.claimOutboxBatch(100, new Date(Date.now() + 3600_000).toISOString());
  const mails = batch.filter((e) => (e.payload as { notificationType?: string }).notificationType === "STEP_UP_CODE");
  expect(mails.length).toBeGreaterThan(0);
  const text = ((mails[mails.length - 1] as unknown as { payload: { text: string } }).payload).text;
  const match = text.match(/\b\d{6}\b/);
  expect(match).toBeTruthy();
  return match?.[0] as string;
}

describe("step-up verification", () => {
  it("requires the emailed code plus a typed name when the project pins both", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    const patch = await fx.owner.agent.patch(`/api/v1/projects/${fx.projectId}`).send({
      settings: { stepUp: { otp: true, typedName: true } },
    });
    expect(patch.status).toBe(200);

    const changeId = await sendableChange(fx.owner.agent, fx.projectId, 50000);
    const send = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(),
    });
    expect(send.status).toBe(201);
    const approvalId = (send.body.approval as { id: string }).id;
    const token = ((send.body as { reviewUrls: string[] }).reviewUrls[0] as string).split("/review/")[1] as string;

    const review = await request(app).get(`/api/v1/approval-requests/${token}`);
    expect(review.body.stepUp).toEqual({ otp: true, typedName: true });

    // Decide with neither: rejected.
    const bare = await request(app).post(`/api/v1/approval-requests/${token}/decisions`).send({
      decision: "APPROVED",
      confirm: true,
    });
    expect(bare.status).toBe(422);

    const req = await request(app).post(`/api/v1/approval-requests/${token}/step-up`).send({});
    expect(req.status).toBe(202);
    const code = await emailedCode(store);

    // The stored challenge is hashed; the audit never sees the code.
    const challenges = await store.listStepUpChallenges(approvalId);
    expect(challenges).toHaveLength(1);
    expect(challenges[0]?.codeHash).not.toContain(code);
    const events = (await store.listAuditEvents({ projectId: fx.projectId, limit: 100 })).items;
    const requested = events.find((e) => e.action === "approval.step_up_requested");
    expect(requested).toBeTruthy();
    expect(JSON.stringify(requested?.after)).not.toContain(code);

    // Wrong guess counts; the error leaks nothing about the real code.
    const wrong = await request(app).post(`/api/v1/approval-requests/${token}/decisions`).send({
      decision: "APPROVED",
      otp: code === "000000" ? "000001" : "000000",
      typedName: "Carl Client",
      confirm: true,
    });
    expect(wrong.status).toBe(422);
    expect((await store.listStepUpChallenges(approvalId))[0]?.attempts).toBe(1);

    // Right code but no name: still rejected (typed name required).
    const noname = await request(app).post(`/api/v1/approval-requests/${token}/decisions`).send({
      decision: "APPROVED",
      otp: code,
      confirm: true,
    });
    expect(noname.status).toBe(422);

    const decide = await request(app).post(`/api/v1/approval-requests/${token}/decisions`).send({
      decision: "APPROVED",
      otp: code,
      typedName: "  Carl Client ",
      confirm: true,
    });
    expect(decide.status).toBe(201);
    expect((await store.listStepUpChallenges(approvalId))[0]?.consumedAt).not.toBeNull();
    const done = await fx.owner.agent.get(`/api/v1/change-requests/${changeId}`);
    expect((done.body as { status: string }).status).toBe("APPROVED");
    const decisions = await store.listDecisions(approvalId);
    expect(decisions[0]?.typedName).toBe("Carl Client");
  });

  it("locks out after too many wrong guesses until a fresh code is requested", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    await fx.owner.agent.patch(`/api/v1/projects/${fx.projectId}`).send({ settings: { stepUp: { otp: true } } });
    const changeId = await sendableChange(fx.owner.agent, fx.projectId, 50000);
    const send = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(),
    });
    const approvalId = (send.body.approval as { id: string }).id;
    const token = ((send.body as { reviewUrls: string[] }).reviewUrls[0] as string).split("/review/")[1] as string;
    await request(app).post(`/api/v1/approval-requests/${token}/step-up`).send({});
    const code = await emailedCode(store);

    const wrong = code === "111111" ? "222222" : "111111";
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post(`/api/v1/approval-requests/${token}/decisions`).send({
        decision: "APPROVED",
        otp: wrong,
        confirm: true,
      });
      expect(res.status).toBe(422);
    }
    // Even the right code is now dead on this challenge.
    const late = await request(app).post(`/api/v1/approval-requests/${token}/decisions`).send({
      decision: "APPROVED",
      otp: code,
      confirm: true,
    });
    expect(late.status).toBe(422);
    expect(late.body.message ?? JSON.stringify(late.body)).toMatch(/Too many/);

    // Cooldown blocks an instant re-request; after it, a fresh code works.
    const immediate = await request(app).post(`/api/v1/approval-requests/${token}/step-up`).send({});
    expect(immediate.status).toBe(422);
    for (const c of await store.listStepUpChallenges(approvalId)) {
      await store.updateStepUpChallenge(c.id, { createdAt: new Date(Date.now() - 120_000).toISOString() } as never);
    }
    const retry = await request(app).post(`/api/v1/approval-requests/${token}/step-up`).send({});
    expect(retry.status).toBe(202);
    const fresh = await emailedCode(store);
    const decide = await request(app).post(`/api/v1/approval-requests/${token}/decisions`).send({
      decision: "APPROVED",
      otp: fresh,
      confirm: true,
    });
    expect(decide.status).toBe(201);
  });

  it("binds codes to their own token, approver, and approval", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    await fx.owner.agent.patch(`/api/v1/projects/${fx.projectId}`).send({ settings: { stepUp: { otp: true } } });
    const changeId = await sendableChange(fx.owner.agent, fx.projectId, 50000);
    const send = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      approverEmails: ["dana@client.test"],
      policyMode: "ALL",
      expiresAt: EXPIRY(),
    });
    const approvalId = (send.body.approval as { id: string }).id;
    const [first, second] = ((send.body as { reviewUrls: string[] }).reviewUrls as string[]).map(
      (u) => u.split("/review/")[1] as string,
    );
    await request(app).post(`/api/v1/approval-requests/${first}/step-up`).send({});
    const code = await emailedCode(store);

    // The other approver cannot spend this code.
    const cross = await request(app).post(`/api/v1/approval-requests/${second}/decisions`).send({
      decision: "APPROVED",
      otp: code,
      confirm: true,
    });
    expect(cross.status).toBe(422);
    // …and the attempt did not burn the real challenge.
    expect((await store.listStepUpChallenges(approvalId))[0]?.attempts).toBe(0);

    // A code from a different approval is equally useless.
    const change2 = await sendableChange(fx.owner.agent, fx.projectId, 1000);
    const send2 = await fx.owner.agent.post(`/api/v1/change-requests/${change2}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(),
    });
    const token2 = ((send2.body as { reviewUrls: string[] }).reviewUrls[0] as string).split("/review/")[1] as string;
    const crossApproval = await request(app).post(`/api/v1/approval-requests/${token2}/decisions`).send({
      decision: "APPROVED",
      otp: code,
      confirm: true,
    });
    expect(crossApproval.status).toBe(422);

    // The rightful owner still decides with it.
    const decide = await request(app).post(`/api/v1/approval-requests/${first}/decisions`).send({
      decision: "APPROVED",
      otp: code,
      confirm: true,
    });
    expect(decide.status).toBe(201);
    expect(decide.body.outcome.state).toBe("PENDING");
  });

  it("rejects expired codes", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    await fx.owner.agent.patch(`/api/v1/projects/${fx.projectId}`).send({ settings: { stepUp: { otp: true } } });
    const changeId = await sendableChange(fx.owner.agent, fx.projectId, 50000);
    const send = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(),
    });
    const approvalId = (send.body.approval as { id: string }).id;
    const token = ((send.body as { reviewUrls: string[] }).reviewUrls[0] as string).split("/review/")[1] as string;
    await request(app).post(`/api/v1/approval-requests/${token}/step-up`).send({});
    const code = await emailedCode(store);
    for (const c of await store.listStepUpChallenges(approvalId)) {
      await store.updateStepUpChallenge(c.id, { expiresAt: new Date(Date.now() - 1000).toISOString() } as never);
    }
    const decide = await request(app).post(`/api/v1/approval-requests/${token}/decisions`).send({
      decision: "APPROVED",
      otp: code,
      confirm: true,
    });
    expect(decide.status).toBe(410);
  });

  it("inherits the org default unless the project pins its own", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const orgPatch = await fx.owner.agent.patch(`/api/v1/organizations/${fx.organizationId}`).send({
      stepUp: { otp: true, typedName: true },
    });
    expect(orgPatch.status).toBe(200);

    const check = async (): Promise<{ otp: boolean; typedName: boolean }> => {
      const changeId = await sendableChange(fx.owner.agent, fx.projectId, 50000);
      const send = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
        approverUserIds: [fx.clientUserId],
        expiresAt: EXPIRY(),
      });
      const token = ((send.body as { reviewUrls: string[] }).reviewUrls[0] as string).split("/review/")[1] as string;
      const review = await request(app).get(`/api/v1/approval-requests/${token}`);
      return review.body.stepUp as { otp: boolean; typedName: boolean };
    };

    // Inherits both.
    expect(await check()).toEqual({ otp: true, typedName: true });

    // Project pins OTP off; typed name still inherits.
    await fx.owner.agent.patch(`/api/v1/projects/${fx.projectId}`).send({ settings: { stepUp: { otp: false } } });
    expect(await check()).toEqual({ otp: false, typedName: true });

    // Explicit null resets to inherit.
    await fx.owner.agent.patch(`/api/v1/projects/${fx.projectId}`).send({ settings: { stepUp: { otp: null } } });
    expect(await check()).toEqual({ otp: true, typedName: true });
  });

  it("works for assigned approvers deciding in-app by approval id", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    await fx.owner.agent.patch(`/api/v1/projects/${fx.projectId}`).send({ settings: { stepUp: { otp: true } } });
    const changeId = await sendableChange(fx.owner.agent, fx.projectId, 50000);
    const send = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [fx.owner.user.id],
      expiresAt: EXPIRY(),
    });
    const approvalId = (send.body.approval as { id: string }).id;

    const byId = await fx.owner.agent.get(`/api/v1/approval-requests/${approvalId}`);
    expect(byId.body.stepUp).toEqual({ otp: true, typedName: false });

    const req = await fx.owner.agent.post(`/api/v1/approval-requests/${approvalId}/step-up`).send({});
    expect(req.status).toBe(202);
    const code = await emailedCode(store);
    const decide = await fx.owner.agent.post(`/api/v1/approval-requests/${approvalId}/decisions`).send({
      decision: "APPROVED",
      comment: "In-app approval",
      otp: code,
      confirm: true,
    });
    expect(decide.status).toBe(201);
  });

  it("refuses codes where step-up is off, and unknown tokens stay opaque", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const changeId = await sendableChange(fx.owner.agent, fx.projectId, 50000);
    const send = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(),
    });
    const token = ((send.body as { reviewUrls: string[] }).reviewUrls[0] as string).split("/review/")[1] as string;

    const req = await request(app).post(`/api/v1/approval-requests/${token}/step-up`).send({});
    expect(req.status).toBe(422);

    const ghost = await request(app).post("/api/v1/approval-requests/does-not-exist/step-up").send({});
    expect(ghost.status).toBe(404);

    // And deciding stays code-free.
    const decide = await request(app).post(`/api/v1/approval-requests/${token}/decisions`).send({
      decision: "APPROVED",
      confirm: true,
    });
    expect(decide.status).toBe(201);
  });
});

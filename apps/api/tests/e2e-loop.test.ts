import { describe, expect, it } from "vitest";
import request from "supertest";
import { agencyFixture, createTestApp, draftScope, register } from "./helpers.js";

/**
 * The six high-risk scenarios from the plan's testing strategy, plus the
 * authenticated approver path and revocation flow.
 */
describe("high-risk e2e scenarios", () => {
  async function readyChange(fx: Awaited<ReturnType<typeof agencyFixture>>): Promise<string> {
    const created = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/change-requests`).send({
      title: "Risky", description: "needs decision", source: "AGENCY",
    });
    const changeId = created.body.id as string;
    let v = created.body.version as number;
    for (const status of ["SUBMITTED", "TRIAGING", "ESTIMATING"]) {
      const res = await fx.owner.agent.patch(`/api/v1/change-requests/${changeId}`).send({ expectedVersion: v, status });
      v = res.body.version as number;
    }
    await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/impact`).send({ effortDays: 1, priceMinor: 100, confidence: "LOW" });
    return changeId;
  }

  it("1. a client cannot open another organization's project by changing an id", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const other = await register(app, { email: "other@test.dev", organizationName: "Other" });
    expect((await other.agent.get(`/api/v1/projects/${fx.projectId}`)).status).toBe(404);
    expect((await other.agent.get(`/api/v1/projects/${fx.projectId}/activity`)).status).toBe(404);
    const change = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/change-requests`).send({
      title: "x", description: "y", source: "AGENCY",
    });
    expect((await other.agent.get(`/api/v1/change-requests/${change.body.id as string}`)).status).toBe(404);
  });

  it("2. a published scope cannot be modified in place", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const { draftId, version } = await draftScope(fx.owner.agent, fx.projectId);
    await fx.owner.agent.post(`/api/v1/scope-versions/${draftId}/publish`).send({ expectedVersion: version });
    const before = await fx.owner.agent.get(`/api/v1/scope-versions/${draftId}`);
    expect((await fx.owner.agent.patch(`/api/v1/scope-versions/${draftId}`).send({ expectedVersion: 999, title: "mutate" })).status).toBe(409);
    const after = await fx.owner.agent.get(`/api/v1/scope-versions/${draftId}`);
    expect(after.body).toEqual(before.body);
  });

  it("3. a material proposal edit invalidates the earlier pending approval", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const changeId = await readyChange(fx);
    const send = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(send.status).toBe(201);
    const detail = await fx.owner.agent.get(`/api/v1/change-requests/${changeId}`);
    await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/impact`).send({
      expectedVersion: (detail.body as { version: number }).version,
      effortDays: 5, priceMinor: 999, confidence: "LOW",
    });
    const reread = await fx.owner.agent.get(`/api/v1/change-requests/${changeId}`);
    expect((reread.body as { approvals: Array<{ status: string }> }).approvals[0]?.status).toBe("INVALIDATED");
    expect((reread.body as { status: string }).status).toBe("ESTIMATING");
  });

  it("4. only an authorized approver decides, bound to the reviewed checksum", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const changeId = await readyChange(fx);
    const send = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const approval = send.body.approval as { id: string; checksum: string };
    // The agency owner is not an assigned approver → 403 on the authed path.
    const ownerDecide = await fx.owner.agent.post(`/api/v1/approval-requests/${approval.id}/decisions`).send({
      decision: "APPROVED", confirm: true,
    });
    expect(ownerDecide.status).toBe(403);
    // The assigned client approver decides via session (no review link needed).
    const clientDecide = await fx.client.agent.post(`/api/v1/approval-requests/${approval.id}/decisions`).send({
      decision: "APPROVED", comment: "Ship it", confirm: true,
    });
    expect(clientDecide.status).toBe(201);
    expect(clientDecide.body.checksum).toBe(approval.checksum);
  });

  it("5. a failure during publish/decision leaves no partial state", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    const { draftId, version } = await draftScope(fx.owner.agent, fx.projectId);

    const realUpdateScope = store.updateScopeVersion.bind(store);
    store.updateScopeVersion = async () => { throw new Error("simulated db failure"); };
    const failed = await fx.owner.agent.post(`/api/v1/scope-versions/${draftId}/publish`).send({ expectedVersion: version });
    expect(failed.status).toBe(500);
    store.updateScopeVersion = realUpdateScope;
    const draft = await fx.owner.agent.get(`/api/v1/scope-versions/${draftId}`);
    expect(draft.body.status).toBe("DRAFT");
    const activity = await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/activity`);
    expect((activity.body.data as Array<{ action: string }>).some((e) => e.action === "scope.published")).toBe(false);

    // Decision path: fail inside the transaction, then verify nothing persisted.
    const changeId = await readyChange(fx);
    const send = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const token = ((send.body as { reviewUrls: string[] }).reviewUrls[0] as string).split("/review/")[1] as string;
    const realCreateDecision = store.createDecision.bind(store);
    store.createDecision = async () => { throw new Error("simulated db failure"); };
    const failedDecision = await request(app).post(`/api/v1/approval-requests/${token}/decisions`).send({
      decision: "APPROVED", confirm: true,
    });
    expect(failedDecision.status).toBe(500);
    store.createDecision = realCreateDecision;
    const reread = await fx.owner.agent.get(`/api/v1/change-requests/${changeId}`);
    expect((reread.body as { status: string }).status).toBe("PENDING_APPROVAL");
    expect((reread.body as { approvals: Array<{ status: string }> }).approvals[0]?.status).toBe("SENT");
    expect((reread.body as { decisions: unknown[] }).decisions).toHaveLength(0);
    // And the package still decides cleanly afterwards.
    const retry = await request(app).post(`/api/v1/approval-requests/${token}/decisions`).send({
      decision: "APPROVED", confirm: true,
    });
    expect(retry.status).toBe(201);
  });

  // High-risk scenario 6 (invented AI IDs rejected) is covered in ai.test.ts.
  it("clients see decisions, history, and exports without agency powers", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const changeId = await readyChange(fx);
    const send = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const token = ((send.body as { reviewUrls: string[] }).reviewUrls[0] as string).split("/review/")[1] as string;
    await request(app).post(`/api/v1/approval-requests/${token}/decisions`).send({ decision: "APPROVED", confirm: true });

    const decisions = await fx.client.agent.get(`/api/v1/projects/${fx.projectId}/decisions`);
    expect(decisions.status).toBe(200);
    expect(decisions.body.data).toHaveLength(1);
    const exported = await fx.client.agent.get(`/api/v1/projects/${fx.projectId}/export/change/${changeId}`);
    expect(exported.status).toBe(200);
    expect(exported.body.approvals[0].decisions).toHaveLength(1);
    const activity = await fx.client.agent.get(`/api/v1/projects/${fx.projectId}/activity?limit=100`);
    const actions = (activity.body.data as Array<{ action: string }>).map((e) => e.action);
    for (const expected of ["change.created", "change.impact_recorded", "approval.sent", "approval.decided"]) {
      expect(actions).toContain(expected);
    }
  });

  it("revocation withdraws a pending package and allows a clean resend", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const changeId = await readyChange(fx);
    const send = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const approvalId = (send.body.approval as { id: string }).id;
    const revoke = await fx.owner.agent.post(`/api/v1/approval-requests/${approvalId}/revoke`).send({ reason: "Price typo" });
    expect(revoke.status).toBe(200);
    const token = ((send.body as { reviewUrls: string[] }).reviewUrls[0] as string).split("/review/")[1] as string;
    expect((await request(app).get(`/api/v1/approval-requests/${token}`)).status).toBe(404);
    const resend = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(resend.status).toBe(201);
  });
});

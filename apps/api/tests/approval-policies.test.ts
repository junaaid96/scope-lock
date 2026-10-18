import { describe, expect, it } from "vitest";
import request from "supertest";
import { agencyFixture, createTestApp, register, type Agent } from "./helpers.js";

const EXPIRY = (): string => new Date(Date.now() + 7 * 86_400_000).toISOString();

/** AGENCY-created change moved to ESTIMATING with a priced impact: ready to send. */
async function sendableChange(agent: Agent, projectId: string, priceMinor: number, title = "Policy probe"): Promise<string> {
  const created = await agent.post(`/api/v1/projects/${projectId}/change-requests`).send({
    title,
    description: `${title} description`,
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

function tokensOf(sendBody: unknown): string[] {
  return ((sendBody as { reviewUrls: string[] }).reviewUrls ?? []).map((u) => u.split("/review/")[1] as string);
}

describe("approval policies", () => {
  it("ALL: holds PENDING until every approver votes, then applies side effects once", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    const changeId = await sendableChange(fx.owner.agent, fx.projectId, 120000);
    const send = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      approverEmails: ["dana@client.test"],
      policyMode: "ALL",
      expiresAt: EXPIRY(),
    });
    expect(send.status).toBe(201);
    const [first, second] = tokensOf(send.body);
    expect((send.body.approval as { policy: unknown }).policy).toEqual({ mode: "ALL", approverOrder: [] });

    const vote1 = await request(app).post(`/api/v1/approval-requests/${first}/decisions`).send({
      decision: "APPROVED",
      confirm: true,
    });
    expect(vote1.status).toBe(201);
    expect(vote1.body.outcome.state).toBe("PENDING");

    // Partial vote: no side effects yet — change still waiting, approval still SENT.
    const mid = await fx.owner.agent.get(`/api/v1/change-requests/${changeId}`);
    expect((mid.body as { status: string }).status).toBe("PENDING_APPROVAL");
    const review = await request(app).get(`/api/v1/approval-requests/${second}`);
    expect(review.body.status).toBe("SENT");
    expect(review.body.policyState.outcome.state).toBe("PENDING");
    expect(review.body.policyState.approvers).toHaveLength(2);
    expect(review.body.policyState.approvers.filter((a: { decision: string | null }) => a.decision).map((a: { email: string }) => a.email)).toEqual([
      "carl@client.test",
    ]);

    const vote2 = await request(app).post(`/api/v1/approval-requests/${second}/decisions`).send({
      decision: "APPROVED",
      confirm: true,
    });
    expect(vote2.status).toBe(201);
    expect(vote2.body.outcome.state).toBe("APPROVED");

    const done = await fx.owner.agent.get(`/api/v1/change-requests/${changeId}`);
    expect((done.body as { status: string }).status).toBe("APPROVED");

    // One audit event per vote, one decision notification for the terminal outcome.
    const events = (await store.listAuditEvents({ projectId: fx.projectId, limit: 100 })).items;
    const decided = events.filter((e) => e.action === "approval.decided");
    expect(decided).toHaveLength(2);
    expect(decided.map((e) => (e.after as { outcome: string }).outcome).sort()).toEqual(["APPROVED", "PENDING"]);
    const notes = await store.listNotifications(fx.owner.user.id, { limit: 50 });
    expect(notes.items.filter((n) => n.type === "APPROVAL_DECIDED")).toHaveLength(1);
  });

  it("ALL: the first rejection is binding and locks the package", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const changeId = await sendableChange(fx.owner.agent, fx.projectId, 120000);
    const send = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      approverEmails: ["dana@client.test"],
      policyMode: "ALL",
      expiresAt: EXPIRY(),
    });
    const [first, second] = tokensOf(send.body);
    const veto = await request(app).post(`/api/v1/approval-requests/${first}/decisions`).send({
      decision: "REJECTED",
      comment: "Too expensive",
      confirm: true,
    });
    expect(veto.status).toBe(201);
    expect(veto.body.outcome.state).toBe("REJECTED");
    const late = await request(app).post(`/api/v1/approval-requests/${second}/decisions`).send({
      decision: "APPROVED",
      confirm: true,
    });
    expect(late.status).toBe(409);
    const done = await fx.owner.agent.get(`/api/v1/change-requests/${changeId}`);
    expect((done.body as { status: string }).status).toBe("REJECTED");
  });

  it("SEQUENTIAL: enforces turn order and unlocks the form in turn", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const changeId = await sendableChange(fx.owner.agent, fx.projectId, 120000);
    const send = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      approverEmails: ["dana@client.test"],
      policyMode: "SEQUENTIAL",
      expiresAt: EXPIRY(),
    });
    expect(send.status).toBe(201);
    const [first, second] = tokensOf(send.body);

    // Second approver jumps the queue.
    const early = await request(app).post(`/api/v1/approval-requests/${second}/decisions`).send({
      decision: "APPROVED",
      confirm: true,
    });
    expect(early.status).toBe(409);
    const waiting = await request(app).get(`/api/v1/approval-requests/${second}`);
    expect(waiting.body.policyState.yourTurn).toBe(false);
    expect(waiting.body.policyState.yourDecision).toBeNull();

    const vote1 = await request(app).post(`/api/v1/approval-requests/${first}/decisions`).send({
      decision: "APPROVED",
      confirm: true,
    });
    expect(vote1.status).toBe(201);
    expect(vote1.body.outcome.state).toBe("PENDING");
    const unlocked = await request(app).get(`/api/v1/approval-requests/${second}`);
    expect(unlocked.body.policyState.yourTurn).toBe(true);
    const vote2 = await request(app).post(`/api/v1/approval-requests/${second}/decisions`).send({
      decision: "APPROVED",
      confirm: true,
    });
    expect(vote2.body.outcome.state).toBe("APPROVED");
  });

  it("rejects a second vote from the same approver while the policy is pending", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const changeId = await sendableChange(fx.owner.agent, fx.projectId, 120000);
    const send = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      approverEmails: ["dana@client.test"],
      policyMode: "ALL",
      expiresAt: EXPIRY(),
    });
    const [first] = tokensOf(send.body);
    const vote1 = await request(app).post(`/api/v1/approval-requests/${first}/decisions`).send({
      decision: "APPROVED",
      confirm: true,
    });
    expect(vote1.status).toBe(201);
    const again = await request(app).post(`/api/v1/approval-requests/${first}/decisions`).send({
      decision: "REJECTED",
      comment: "changed my mind",
      confirm: true,
    });
    expect(again.status).toBe(409);
  });

  it("resolves the mode from amount thresholds unless overridden", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const patch = await fx.owner.agent.patch(`/api/v1/projects/${fx.projectId}`).send({
      settings: {
        approvalPolicies: [
          { uptoMinor: 50000, mode: "ANY" },
          { uptoMinor: null, mode: "ALL" },
        ],
      },
    });
    expect(patch.status).toBe(200);

    const cheap = await sendableChange(fx.owner.agent, fx.projectId, 10000, "Cheap tweak");
    const sendCheap = await fx.owner.agent.post(`/api/v1/change-requests/${cheap}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      approverEmails: ["dana@client.test"],
      expiresAt: EXPIRY(),
    });
    expect((sendCheap.body.approval as { policy: unknown }).policy).toEqual({ mode: "ANY", approverOrder: [] });

    const pricey = await sendableChange(fx.owner.agent, fx.projectId, 200000, "Pricey rebuild");
    const sendPricey = await fx.owner.agent.post(`/api/v1/change-requests/${pricey}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      approverEmails: ["dana@client.test"],
      expiresAt: EXPIRY(),
    });
    expect((sendPricey.body.approval as { policy: unknown }).policy).toEqual({ mode: "ALL", approverOrder: [] });

    const override = await sendableChange(fx.owner.agent, fx.projectId, 200000, "Override probe");
    const sendOverride = await fx.owner.agent.post(`/api/v1/change-requests/${override}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      approverEmails: ["dana@client.test"],
      policyMode: "SEQUENTIAL",
      expiresAt: EXPIRY(),
    });
    expect((sendOverride.body.approval as { policy: { mode: string; approverOrder: string[] } }).policy.mode).toBe("SEQUENTIAL");
    expect((sendOverride.body.approval as { policy: { mode: string; approverOrder: string[] } }).policy.approverOrder).toHaveLength(2);
  });

  it("rejects non-ascending threshold rules on the project", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const bad = await fx.owner.agent.patch(`/api/v1/projects/${fx.projectId}`).send({
      settings: {
        approvalPolicies: [
          { uptoMinor: 50000, mode: "ANY" },
          { uptoMinor: 10000, mode: "ALL" },
        ],
      },
    });
    expect(bad.status).toBe(422);
  });

  it("invalidates across every approver when the proposal changes mid-vote", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const changeId = await sendableChange(fx.owner.agent, fx.projectId, 120000);
    const send = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      approverEmails: ["dana@client.test"],
      policyMode: "ALL",
      expiresAt: EXPIRY(),
    });
    const [first, second] = tokensOf(send.body);
    const vote1 = await request(app).post(`/api/v1/approval-requests/${first}/decisions`).send({
      decision: "APPROVED",
      confirm: true,
    });
    expect(vote1.body.outcome.state).toBe("PENDING");

    const detail = await fx.owner.agent.get(`/api/v1/change-requests/${changeId}`);
    const edit = await fx.owner.agent.patch(`/api/v1/change-requests/${changeId}`).send({
      expectedVersion: (detail.body as { version: number }).version,
      description: "v2 — scope grew",
    });
    expect(edit.status).toBe(200);
    const after = await fx.owner.agent.get(`/api/v1/change-requests/${changeId}`);
    expect(((after.body as { approvals: Array<{ status: string }> }).approvals[0] as { status: string }).status).toBe("INVALIDATED");

    const late = await request(app).post(`/api/v1/approval-requests/${second}/decisions`).send({
      decision: "APPROVED",
      confirm: true,
    });
    expect(late.status).toBe(409);
    const stale = await request(app).get(`/api/v1/approval-requests/${first}`);
    expect(stale.body.status).toBe("INVALIDATED");
    expect(stale.body.decisions).toHaveLength(1);
  });

  it("blocks outsiders, non-senders, and non-member approvers", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const stranger = await register(app, { email: "mallory@evil.test", organizationName: "Evil" });
    const changeId = await sendableChange(fx.owner.agent, fx.projectId, 120000);

    const send = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(),
    });
    expect(send.status).toBe(201);
    const approvalId = (send.body.approval as { id: string }).id;

    // Stranger cannot read the approval by id.
    const snoop = await stranger.agent.get(`/api/v1/approval-requests/${approvalId}`);
    expect([401, 403, 404]).toContain(snoop.status);

    // Client approver cannot send.
    const rogue = await fx.client.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(),
    });
    expect(rogue.status).toBe(403);

    // Non-members cannot be named as account approvers.
    const bad = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [stranger.user.id],
      expiresAt: EXPIRY(),
    });
    expect(bad.status).toBe(422);

    // Unknown tokens stay opaque.
    const ghost = await request(app).post("/api/v1/approval-requests/does-not-exist/decisions").send({
      decision: "APPROVED",
      confirm: true,
    });
    expect(ghost.status).toBe(404);
  });
});

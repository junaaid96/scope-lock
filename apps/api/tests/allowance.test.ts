import { describe, expect, it } from "vitest";
import request from "supertest";
import { agencyFixture, createTestApp, draftScope, register, type Agent } from "./helpers.js";

const EXPIRY = (): string => new Date(Date.now() + 7 * 86_400_000).toISOString();

async function readyChange(agent: Agent, projectId: string, priceMinor: number): Promise<string> {
  const created = await agent.post(`/api/v1/projects/${projectId}/change-requests`).send({
    title: "Pool-funded work",
    description: "Work that draws from the allowance pool on approval.",
  });
  if (created.status !== 201) throw new Error(`create change failed: ${JSON.stringify(created.body)}`);
  const changeId = (created.body as { id: string }).id;
  let version = (created.body as { version: number }).version;
  const submit = await agent.post(`/api/v1/change-requests/${changeId}/submit`).send({ expectedVersion: version });
  version = (submit.body as { version: number }).version;
  for (const status of ["TRIAGING", "ESTIMATING"]) {
    const patched = await agent.patch(`/api/v1/change-requests/${changeId}`).send({
      expectedVersion: version,
      status,
      ...(status === "TRIAGING" ? { classification: "POTENTIAL_CHANGE", classificationRationale: "New work" } : {}),
    });
    version = (patched.body as { version: number }).version;
  }
  const impact = await agent.post(`/api/v1/change-requests/${changeId}/impact`).send({
    effortDays: 2,
    priceMinor,
    confidence: "MEDIUM",
  });
  if (impact.status !== 201) throw new Error(`impact failed: ${JSON.stringify(impact.body)}`);
  return changeId;
}

function tokenFrom(sendBody: unknown): string {
  return ((sendBody as { reviewUrls: string[] }).reviewUrls[0] as string).split("/review/")[1] as string;
}

describe("allowance pools", () => {
  it("creates, lists, and edits pools with balances", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const created = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/allowance-pools`).send({
      name: "Sprint buffer",
      kind: "HOURS",
      totalHours: 40,
      objectionWindowHours: 48,
      enabled: true,
    });
    expect(created.status).toBe(201);
    expect((created.body as { status: string }).status).toBe("PROPOSED");
    expect((created.body as { balance: { remainingHours: number } }).balance.remainingHours).toBe(40);

    // AMOUNT pools must use the project currency.
    const wrongCurrency = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/allowance-pools`).send({
      name: "Euro buffer",
      kind: "AMOUNT",
      totalMinor: 50000,
      currency: "EUR",
      objectionWindowHours: 72,
    });
    expect(wrongCurrency.status).toBe(422);

    const amount = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/allowance-pools`).send({
      name: "Cash buffer",
      kind: "AMOUNT",
      totalMinor: 50000,
      currency: "USD",
      objectionWindowHours: 72,
      enabled: false,
    });
    expect(amount.status).toBe(201);

    const list = await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/allowance-pools?limit=50`);
    expect(list.status).toBe(200);
    const body = list.body as { data: Array<{ id: string; balance: unknown; drawDowns: unknown[] }>; pagination: { nextCursor: string | null } };
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toHaveProperty("balance");
    expect(body.data[0]).toHaveProperty("drawDowns");
    expect(body.pagination).toHaveProperty("nextCursor");

    // Clients can read but not manage.
    const clientList = await fx.client.agent.get(`/api/v1/projects/${fx.projectId}/allowance-pools?limit=50`);
    expect(clientList.status).toBe(200);
    const clientCreate = await fx.client.agent.post(`/api/v1/projects/${fx.projectId}/allowance-pools`).send({
      name: "Sneaky",
      kind: "HOURS",
      totalHours: 10,
    });
    expect(clientCreate.status).toBe(403);

    // Edit terms while PROPOSED.
    const poolId = (created.body as { id: string }).id;
    const edited = await fx.owner.agent.patch(`/api/v1/allowance-pools/${poolId}`).send({ name: "Sprint buffer v2", totalHours: 50 });
    expect(edited.status).toBe(200);
    expect((edited.body as { name: string }).name).toBe("Sprint buffer v2");

    // Activation by edit is rejected: only a recorded client decision activates.
    const sneakActive = await fx.owner.agent.patch(`/api/v1/allowance-pools/${poolId}`).send({ status: "ACTIVE" });
    expect(sneakActive.status).toBe(422);
  });

  it("hides pools from outsiders (IDOR)", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const stranger = await register(app, { email: "stranger@other.test", organizationName: "Other" });
    const created = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/allowance-pools`).send({
      name: "Buffer",
      kind: "HOURS",
      totalHours: 10,
    });
    const poolId = (created.body as { id: string }).id;
    expect((await stranger.agent.get(`/api/v1/projects/${fx.projectId}/allowance-pools`)).status).toBe(404);
    expect((await stranger.agent.patch(`/api/v1/allowance-pools/${poolId}`).send({ name: "x" })).status).toBe(404);
  });

  it("activates a pool only through a recorded client grant decision", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    const created = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/allowance-pools`).send({
      name: "Grant me",
      kind: "HOURS",
      totalHours: 20,
      objectionWindowHours: 72,
      enabled: true,
    });
    const poolId = (created.body as { id: string }).id;

    const send = await fx.owner.agent.post(`/api/v1/allowance-pools/${poolId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(),
    });
    expect(send.status).toBe(201);
    const token = tokenFrom(send.body);

    // Grant package exposes exactly the terms, bound by checksum.
    const review = await request(app).get(`/api/v1/approval-requests/${token}`);
    expect(review.status).toBe(200);
    expect(review.body.package.allowance).toMatchObject({ poolId, kind: "HOURS", totalHours: 20, objectionWindowHours: 72 });

    // Second send while one awaits decision is rejected.
    const dup = await fx.owner.agent.post(`/api/v1/allowance-pools/${poolId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(),
    });
    expect(dup.status).toBe(409);

    const decide = await request(app).post(`/api/v1/approval-requests/${token}/decisions`).send({
      decision: "APPROVED",
      comment: "Agreed",
      confirm: true,
    });
    expect(decide.status).toBe(201);

    const pool = await store.findAllowancePoolById(poolId);
    expect(pool?.status).toBe("ACTIVE");
    expect(pool?.grantDecisionId).toBe((decide.body as { id: string }).id);
    const events = (await store.listAuditEvents({ projectId: fx.projectId, limit: 100 })).items;
    expect(events.map((e) => e.action)).toContain("allowance.activated");
  });

  it("invalidates a SENT grant when terms change", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const created = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/allowance-pools`).send({
      name: "Shifting",
      kind: "HOURS",
      totalHours: 20,
      enabled: true,
    });
    const poolId = (created.body as { id: string }).id;
    const send = await fx.owner.agent.post(`/api/v1/allowance-pools/${poolId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(),
    });
    expect(send.status).toBe(201);
    const edited = await fx.owner.agent.patch(`/api/v1/allowance-pools/${poolId}`).send({ totalHours: 30 });
    expect(edited.status).toBe(200);
    const token = tokenFrom(send.body);
    const review = await request(app).get(`/api/v1/approval-requests/${token}`);
    expect(review.body.status).toBe("INVALIDATED");
    // A fresh grant can go out for the new terms.
    const resend = await fx.owner.agent.post(`/api/v1/allowance-pools/${poolId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(),
    });
    expect(resend.status).toBe(201);
  });

  it("draws down on approval, notifies the client, and blocks overdraws", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    const { draftId, version } = await draftScope(fx.owner.agent, fx.projectId);
    await fx.owner.agent.post(`/api/v1/scope-versions/${draftId}/publish`).send({ expectedVersion: version });

    const created = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/allowance-pools`).send({
      name: "Draw pool",
      kind: "AMOUNT",
      totalMinor: 100000,
      currency: "USD",
      objectionWindowHours: 72,
      enabled: true,
    });
    const poolId = (created.body as { id: string }).id;
    const grant = await fx.owner.agent.post(`/api/v1/allowance-pools/${poolId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(),
    });
    await request(app).post(`/api/v1/approval-requests/${tokenFrom(grant.body)}/decisions`).send({
      decision: "APPROVED",
      comment: "yes",
      confirm: true,
    });

    const changeId = await readyChange(fx.owner.agent, fx.projectId, 30000);
    const send = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(),
      allowancePoolId: poolId,
    });
    expect(send.status).toBe(201);

    const decide = await request(app).post(`/api/v1/approval-requests/${tokenFrom(send.body)}/decisions`).send({
      decision: "APPROVED",
      comment: "ok",
      confirm: true,
    });
    expect(decide.status).toBe(201);

    const drawDown = await store.findDrawDownByChange(changeId);
    expect(drawDown?.amountMinor).toBe(30000);
    expect(drawDown?.status).toBe("NOTIFIED");
    expect(Date.parse(drawDown?.objectionDeadline as string)).toBeGreaterThan(Date.now());
    const events = (await store.listAuditEvents({ projectId: fx.projectId, limit: 100 })).items;
    expect(events.map((e) => e.action)).toContain("allowance.drawn");
    const notes = (await store.listNotifications(fx.clientUserId, {})).items;
    expect(notes.some((n) => n.type === "ALLOWANCE_DRAWN")).toBe(true);

    const list = await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/allowance-pools?limit=50`);
    const pool = (list.body as { data: Array<{ id: string; balance: { remainingMinor: number }; drawDowns: unknown[] }> }).data[0] as { id: string; balance: { remainingMinor: number }; drawDowns: unknown[] };
    expect(pool.balance.remainingMinor).toBe(70000);
    expect(pool.drawDowns).toHaveLength(1);

    // Overdraws are rejected at send time.
    const big = await readyChange(fx.owner.agent, fx.projectId, 80000);
    const over = await fx.owner.agent.post(`/api/v1/change-requests/${big}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(),
      allowancePoolId: poolId,
    });
    expect(over.status).toBe(422);
  });

  it("lets the client object and the lead resolve", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    const { draftId, version } = await draftScope(fx.owner.agent, fx.projectId);
    await fx.owner.agent.post(`/api/v1/scope-versions/${draftId}/publish`).send({ expectedVersion: version });

    const created = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/allowance-pools`).send({
      name: "Object pool",
      kind: "HOURS",
      totalHours: 40,
      objectionWindowHours: 72,
      enabled: true,
    });
    const poolId = (created.body as { id: string }).id;
    const grant = await fx.owner.agent.post(`/api/v1/allowance-pools/${poolId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(),
    });
    await request(app).post(`/api/v1/approval-requests/${tokenFrom(grant.body)}/decisions`).send({
      decision: "APPROVED",
      comment: "yes",
      confirm: true,
    });
    const changeId = await readyChange(fx.owner.agent, fx.projectId, 10000);
    const send = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(),
      allowancePoolId: poolId,
    });
    await request(app).post(`/api/v1/approval-requests/${tokenFrom(send.body)}/decisions`).send({
      decision: "APPROVED",
      comment: "ok",
      confirm: true,
    });
    const drawDown = await store.findDrawDownByChange(changeId);
    const drawId = drawDown?.id as string;

    // Agency staff cannot object; only client approvers can.
    expect((await fx.owner.agent.post(`/api/v1/allowance-draw-downs/${drawId}/object`).send({ reason: "x" })).status).toBe(403);
    const objected = await fx.client.agent.post(`/api/v1/allowance-draw-downs/${drawId}/object`).send({ reason: "We never agreed to 16h" });
    expect(objected.status).toBe(200);
    expect((objected.body as { status: string }).status).toBe("OBJECTED");
    // Second objection is rejected.
    expect((await fx.client.agent.post(`/api/v1/allowance-draw-downs/${drawId}/object`).send({ reason: "again" })).status).toBe(409);
    const ownerNotes = (await store.listNotifications(fx.owner.user.id, {})).items;
    expect(ownerNotes.some((n) => n.type === "ALLOWANCE_OBJECTED")).toBe(true);

    // Clients cannot resolve their own objection.
    expect((await fx.client.agent.post(`/api/v1/allowance-draw-downs/${drawId}/resolve`).send({ resolution: "RELEASE", note: "x" })).status).toBe(403);
    const released = await fx.owner.agent.post(`/api/v1/allowance-draw-downs/${drawId}/resolve`).send({ resolution: "RELEASE", note: "You are right, releasing" });
    expect(released.status).toBe(200);
    expect((released.body as { status: string }).status).toBe("RELEASED");
    const events = (await store.listAuditEvents({ projectId: fx.projectId, limit: 100 })).items;
    expect(events.map((e) => e.action)).toEqual(expect.arrayContaining(["allowance.objected", "allowance.resolved"]));

    // Released amounts return to the balance.
    const list = await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/allowance-pools?limit=50`);
    const pool = (list.body as { data: Array<{ balance: { remainingHours: number } }> }).data[0] as { balance: { remainingHours: number } };
    expect(pool.balance.remainingHours).toBe(40);
  });

  it("locks totals once ACTIVE and closes pools", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    const created = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/allowance-pools`).send({
      name: "Lock me",
      kind: "HOURS",
      totalHours: 40,
      enabled: true,
    });
    const poolId = (created.body as { id: string }).id;
    const grant = await fx.owner.agent.post(`/api/v1/allowance-pools/${poolId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(),
    });
    await request(app).post(`/api/v1/approval-requests/${tokenFrom(grant.body)}/decisions`).send({
      decision: "APPROVED",
      comment: "yes",
      confirm: true,
    });
    expect((await fx.owner.agent.patch(`/api/v1/allowance-pools/${poolId}`).send({ totalHours: 99 })).status).toBe(422);
    const closed = await fx.owner.agent.patch(`/api/v1/allowance-pools/${poolId}`).send({ status: "CLOSED" });
    expect(closed.status).toBe(200);
    expect((await store.findAllowancePoolById(poolId))?.status).toBe("CLOSED");
    expect((await fx.owner.agent.patch(`/api/v1/allowance-pools/${poolId}`).send({ name: "late" })).status).toBe(409);
  });
});

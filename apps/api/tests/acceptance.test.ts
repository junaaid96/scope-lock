import { describe, expect, it } from "vitest";
import request from "supertest";
import { POLICY_ACTOR } from "@scopelock/domain";
import { drainOnce } from "../src/lib/worker.js";
import { agencyFixture, createTestApp, draftScope, register, type Agent } from "./helpers.js";

const EXPIRY = (ms = 7 * 86_400_000): string => new Date(Date.now() + ms).toISOString();

async function baselineRequirements(agent: Agent, projectId: string): Promise<Array<{ id: string; stableKey: string }>> {
  const { draftId, version } = await draftScope(agent, projectId);
  const published = await agent.post(`/api/v1/scope-versions/${draftId}/publish`).send({ expectedVersion: version });
  expect(published.status).toBe(200);
  const list = await agent.get(`/api/v1/projects/${projectId}/requirements`);
  expect(list.status).toBe(200);
  return (list.body as { data: Array<{ id: string; stableKey: string }> }).data;
}

async function deliver(agent: Agent, req: { id: string; stableKey: string }): Promise<{ id: string; stableKey: string }> {
  for (const status of ["IN_PROGRESS", "DELIVERED"]) {
    const patched = await agent.patch(`/api/v1/requirements/${req.id}`).send({ status });
    expect(patched.status).toBe(200);
  }
  const evidence = await agent.post(`/api/v1/requirements/${req.id}/evidence`).send({
    type: "NOTE",
    title: "Demo recording",
    note: "Walked through on staging.",
  });
  expect(evidence.status).toBe(201);
  return req;
}

async function deliveredRequirement(agent: Agent, projectId: string): Promise<{ id: string; stableKey: string }> {
  const reqs = await baselineRequirements(agent, projectId);
  const req = reqs[0];
  if (!req) throw new Error("expected seeded requirements");
  return deliver(agent, req);
}

async function sendAcceptance(
  agent: Agent,
  projectId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: { approval: { id: string; expiresAt: string }; reviewUrls?: string[] } }> {
  const res = await agent.post(`/api/v1/projects/${projectId}/acceptance-requests`).send(body);
  return { status: res.status, body: res.body as { approval: { id: string; expiresAt: string }; reviewUrls?: string[] } };
}

describe("delivery acceptance", () => {
  it("sends acceptance and a client approval accepts the delivery", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    const req = await deliveredRequirement(fx.owner.agent, fx.projectId);
    const sent = await sendAcceptance(fx.owner.agent, fx.projectId, {
      requirementIds: [req.id],
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(),
    });
    expect(sent.status).toBe(201);
    const token = (sent.body.reviewUrls?.[0] as string).split("/review/")[1] as string;
    const decide = await request(app).post(`/api/v1/approval-requests/${token}/decisions`).send({
      decision: "APPROVED",
      comment: "Works as specified.",
      confirm: true,
    });
    expect(decide.status).toBe(201);
    expect((await store.findRequirementById(req.id))?.status).toBe("ACCEPTED");
    expect((await store.findApprovalById(sent.body.approval.id))?.status).toBe("DECIDED");
    const events = await store.listAuditEvents({ projectId: fx.projectId, targetType: "REQUIREMENT", targetId: req.id, limit: 50 });
    const change = events.items.find((e) => e.action === "requirement.status_changed" && (e.after as { status: string })?.status === "ACCEPTED");
    expect(change?.actorEmail).toBe("carl@client.test");
  });

  it("maps rejection to rework and change-requests to standing delivery", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    const reqs = await baselineRequirements(fx.owner.agent, fx.projectId);
    if (reqs.length < 2 || !reqs[0] || !reqs[1]) throw new Error("expected two seeded requirements");
    const first = await deliver(fx.owner.agent, reqs[0]);
    const sent = await sendAcceptance(fx.owner.agent, fx.projectId, {
      requirementIds: [first.id],
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(),
    });
    const token = (sent.body.reviewUrls?.[0] as string).split("/review/")[1] as string;
    const rejected = await request(app).post(`/api/v1/approval-requests/${token}/decisions`).send({
      decision: "REJECTED",
      comment: "The export is missing.",
      confirm: true,
    });
    expect(rejected.status).toBe(201);
    expect((await store.findRequirementById(first.id))?.status).toBe("IN_PROGRESS");

    const second = await deliver(fx.owner.agent, reqs[1]);
    const sent2 = await sendAcceptance(fx.owner.agent, fx.projectId, {
      requirementIds: [second.id],
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(),
    });
    const token2 = (sent2.body.reviewUrls?.[0] as string).split("/review/")[1] as string;
    const revised = await request(app).post(`/api/v1/approval-requests/${token2}/decisions`).send({
      decision: "CHANGES_REQUESTED",
      comment: "Clarify the empty state.",
      confirm: true,
    });
    expect(revised.status).toBe(201);
    expect((await store.findRequirementById(second.id))?.status).toBe("DELIVERED");
  });

  it("deems overdue acceptance accepted with the policy actor and no client decision", async () => {
    const { app, ctx, store } = createTestApp();
    const fx = await agencyFixture(app);
    const setWindow = await fx.owner.agent.patch(`/api/v1/projects/${fx.projectId}`).send({
      settings: { deemedAcceptanceDays: 7 },
    });
    expect(setWindow.status).toBe(200);
    const req = await deliveredRequirement(fx.owner.agent, fx.projectId);
    // Omitted deadline defaults to the configured window.
    const sent = await sendAcceptance(fx.owner.agent, fx.projectId, {
      requirementIds: [req.id],
      approverUserIds: [fx.clientUserId],
    });
    expect(sent.status).toBe(201);
    const expiresInDays = (Date.parse(sent.body.approval.expiresAt) - Date.now()) / 86_400_000;
    expect(expiresInDays).toBeGreaterThan(6.9);
    expect(expiresInDays).toBeLessThan(7.1);
    // Force the deadline into the past, then drain the worker.
    await store.updateApproval(sent.body.approval.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    await drainOnce({ store: ctx.store, env: ctx.env, email: ctx.email, realtime: ctx.realtime, slack: ctx.slack, sms: ctx.sms, whatsapp: ctx.whatsapp });

    const approval = await store.findApprovalById(sent.body.approval.id);
    expect(approval?.status).toBe("DEEMED");
    expect(approval?.deemedAt).not.toBe(null);
    expect((await store.findRequirementById(req.id))?.status).toBe("ACCEPTED");
    expect(await store.listDecisions(sent.body.approval.id)).toHaveLength(0);
    const events = await store.listAuditEvents({ projectId: fx.projectId, targetType: "APPROVAL", targetId: sent.body.approval.id, limit: 50 });
    const deemed = events.items.find((e) => e.action === "acceptance.deemed");
    expect(deemed?.actorEmail).toBe(POLICY_ACTOR);
    expect(deemed?.actorId).toBe(null);
    const notifications = await store.listNotifications(fx.clientUserId, { limit: 50 });
    expect(notifications.items.some((n) => n.type === "ACCEPTANCE_DEEMED")).toBe(true);
  });

  it("expires acceptance normally when no window is configured", async () => {
    const { app, ctx, store } = createTestApp();
    const fx = await agencyFixture(app);
    const req = await deliveredRequirement(fx.owner.agent, fx.projectId);
    const sent = await sendAcceptance(fx.owner.agent, fx.projectId, {
      requirementIds: [req.id],
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(),
    });
    expect(sent.status).toBe(201);
    await store.updateApproval(sent.body.approval.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    await drainOnce({ store: ctx.store, env: ctx.env, email: ctx.email, realtime: ctx.realtime, slack: ctx.slack, sms: ctx.sms, whatsapp: ctx.whatsapp });
    expect((await store.findApprovalById(sent.body.approval.id))?.status).toBe("EXPIRED");
    expect((await store.findRequirementById(req.id))?.status).toBe("DELIVERED");
  });

  it("reminds approvers with acceptance copy before the deadline", async () => {
    const { app, ctx, store } = createTestApp();
    const fx = await agencyFixture(app);
    await fx.owner.agent.patch(`/api/v1/projects/${fx.projectId}`).send({ settings: { deemedAcceptanceDays: 7 } });
    const req = await deliveredRequirement(fx.owner.agent, fx.projectId);
    const sent = await sendAcceptance(fx.owner.agent, fx.projectId, {
      requirementIds: [req.id],
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(12 * 3_600_000),
    });
    expect(sent.status).toBe(201);
    await drainOnce({ store: ctx.store, env: ctx.env, email: ctx.email, realtime: ctx.realtime, slack: ctx.slack, sms: ctx.sms, whatsapp: ctx.whatsapp });
    expect((await store.findApprovalById(sent.body.approval.id))?.remindersSent).toContain(48);
    const notifications = await store.listNotifications(fx.clientUserId, { limit: 50 });
    const reminder = notifications.items.find((n) => n.type === "APPROVAL_REMINDER");
    expect(reminder?.title).toMatch(/awaiting your acceptance/);
    expect(reminder?.body).toMatch(/deemed accepted/);
  });

  it("rejects sends that are not ready", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const { draftId, version } = await draftScope(fx.owner.agent, fx.projectId);
    await fx.owner.agent.post(`/api/v1/scope-versions/${draftId}/publish`).send({ expectedVersion: version });
    const list = await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/requirements`);
    const req = (list.body as { data: Array<{ id: string }> }).data[0] as { id: string };

    // Not delivered.
    const early = await sendAcceptance(fx.owner.agent, fx.projectId, {
      requirementIds: [req.id],
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(),
    });
    expect(early.status).toBe(422);

    // Unknown requirement.
    const unknown = await sendAcceptance(fx.owner.agent, fx.projectId, {
      requirementIds: ["req_doesnotexist"],
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(),
    });
    expect(unknown.status).toBe(422);

    // No deadline and no configured window.
    await fx.owner.agent.patch(`/api/v1/requirements/${req.id}`).send({ status: "IN_PROGRESS" });
    await fx.owner.agent.patch(`/api/v1/requirements/${req.id}`).send({ status: "DELIVERED" });
    const dateless = await sendAcceptance(fx.owner.agent, fx.projectId, {
      requirementIds: [req.id],
      approverUserIds: [fx.clientUserId],
    });
    expect(dateless.status).toBe(422);

    // Double send while one is pending.
    const first = await sendAcceptance(fx.owner.agent, fx.projectId, {
      requirementIds: [req.id],
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(),
    });
    expect(first.status).toBe(201);
    const second = await sendAcceptance(fx.owner.agent, fx.projectId, {
      requirementIds: [req.id],
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(),
    });
    expect(second.status).toBe(422);
  });

  it("restricts acceptance sends by role", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const req = await deliveredRequirement(fx.owner.agent, fx.projectId);
    const body = { requirementIds: [req.id], approverUserIds: [fx.clientUserId], expiresAt: EXPIRY() };

    const client = await sendAcceptance(fx.client.agent, fx.projectId, body);
    expect(client.status).toBe(403);

    const anon = await request(app).post(`/api/v1/projects/${fx.projectId}/acceptance-requests`).send(body);
    expect(anon.status).toBe(401);

    const outsider = await register(app, { email: "outsider@evil.test", organizationName: "Evil" });
    const idor = await sendAcceptance(outsider.agent, fx.projectId, body);
    expect(idor.status).toBe(404);
  });

  it("invalidates pending acceptance when the delivery changes", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    const req = await deliveredRequirement(fx.owner.agent, fx.projectId);
    const sent = await sendAcceptance(fx.owner.agent, fx.projectId, {
      requirementIds: [req.id],
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(),
    });
    expect(sent.status).toBe(201);
    const attached = await fx.owner.agent.post(`/api/v1/requirements/${req.id}/evidence`).send({
      type: "URL",
      title: "Staging link",
      url: "https://staging.test/demo",
    });
    expect(attached.status).toBe(201);
    const approval = await store.findApprovalById(sent.body.approval.id);
    expect(approval?.status).toBe("INVALIDATED");
    expect(approval?.invalidatedReason).toMatch(/new evidence/);
    // The delivery itself stands, ready for a fresh package.
    expect((await store.findRequirementById(req.id))?.status).toBe("DELIVERED");
  });
});

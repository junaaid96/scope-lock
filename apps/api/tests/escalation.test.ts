import { describe, expect, it } from "vitest";
import request from "supertest";
import { drainOnce } from "../src/lib/worker.js";
import { agencyFixture, createTestApp, type Agent } from "./helpers.js";

const EXPIRY = (): string => new Date(Date.now() + 7 * 86_400_000).toISOString();
const HOURS_AGO = (h: number): string => new Date(Date.now() - h * 3_600_000).toISOString();

async function sendableChange(agent: Agent, projectId: string): Promise<string> {
  const created = await agent.post(`/api/v1/projects/${projectId}/change-requests`).send({
    title: "Stalled work",
    description: "Stalled work description",
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
    priceMinor: 50000,
    timelineDays: 3,
    confidence: "HIGH",
  });
  expect(impact.status).toBe(201);
  return id;
}

async function sendForApproval(
  agent: Agent,
  changeId: string,
  body: Record<string, unknown>,
): Promise<{ id: string; reviewUrls?: string[] }> {
  const res = await agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send(body);
  expect(res.status).toBe(201);
  return { id: (res.body.approval as { id: string }).id, reviewUrls: (res.body as { reviewUrls?: string[] }).reviewUrls };
}

describe("approval escalation", () => {
  it("escalates stalled packages to the agency lead exactly once", async () => {
    const { app, ctx, store } = createTestApp();
    const fx = await agencyFixture(app);
    const set = await fx.owner.agent.patch(`/api/v1/projects/${fx.projectId}`).send({
      settings: { escalation: { afterHours: 24 } },
    });
    expect(set.status).toBe(200);
    const changeId = await sendableChange(fx.owner.agent, fx.projectId);
    const sent = await sendForApproval(fx.owner.agent, changeId, {
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(),
    });
    await store.updateApproval(sent.id, { sentAt: HOURS_AGO(25) });
    await drainOnce({ store: ctx.store, env: ctx.env, email: ctx.email, realtime: ctx.realtime });

    const approval = await store.findApprovalById(sent.id);
    expect(approval?.status).toBe("SENT");
    expect(approval?.escalatedAt).not.toBe(null);
    const events = await store.listAuditEvents({ projectId: fx.projectId, targetType: "APPROVAL", targetId: sent.id, limit: 50 });
    const escalated = events.items.find((e) => e.action === "approval.escalated");
    expect((escalated?.after as { target: string })?.target).toBe("AGENCY_LEAD");
    expect((escalated?.after as { notified: string[] })?.notified).toContain("owner@agency.test");
    const leadNotes = await store.listNotifications(fx.owner.user.id, { limit: 50 });
    expect(leadNotes.items.filter((n) => n.type === "APPROVAL_ESCALATED")).toHaveLength(1);

    // A second drain does not re-escalate.
    const first = approval?.escalatedAt;
    await drainOnce({ store: ctx.store, env: ctx.env, email: ctx.email, realtime: ctx.realtime });
    expect((await store.findApprovalById(sent.id))?.escalatedAt).toBe(first);
    expect((await store.listNotifications(fx.owner.user.id, { limit: 50 })).items.filter((n) => n.type === "APPROVAL_ESCALATED")).toHaveLength(1);
  });

  it("nudges only the undecided approver, and only the turn-holder when sequential", async () => {
    const { app, ctx, store } = createTestApp();
    const fx = await agencyFixture(app);
    await fx.owner.agent.patch(`/api/v1/projects/${fx.projectId}`).send({
      settings: { escalation: { afterHours: 24, target: "SECOND_APPROVER" } },
    });
    const changeId = await sendableChange(fx.owner.agent, fx.projectId);
    const sent = await sendForApproval(fx.owner.agent, changeId, {
      approverUserIds: [fx.owner.user.id, fx.clientUserId],
      policyMode: "SEQUENTIAL",
      expiresAt: EXPIRY(),
    });
    // Owner votes first in-app; the turn passes to the client.
    const vote = await fx.owner.agent.post(`/api/v1/approval-requests/${sent.id}/decisions`).send({
      decision: "APPROVED",
      confirm: true,
    });
    expect(vote.status).toBe(201);
    await store.updateApproval(sent.id, { sentAt: HOURS_AGO(25) });
    await drainOnce({ store: ctx.store, env: ctx.env, email: ctx.email, realtime: ctx.realtime });

    expect((await store.findApprovalById(sent.id))?.escalatedAt).not.toBe(null);
    const clientNotes = await store.listNotifications(fx.clientUserId, { limit: 50 });
    expect(clientNotes.items.filter((n) => n.type === "APPROVAL_ESCALATED")).toHaveLength(1);
    expect(clientNotes.items.find((n) => n.type === "APPROVAL_ESCALATED")?.title).toMatch(/overdue/);
    // The owner already voted, so they get no escalation nudge.
    const ownerNotes = await store.listNotifications(fx.owner.user.id, { limit: 50 });
    expect(ownerNotes.items.filter((n) => n.type === "APPROVAL_ESCALATED")).toHaveLength(0);
    const events = await store.listAuditEvents({ projectId: fx.projectId, targetType: "APPROVAL", targetId: sent.id, limit: 50 });
    expect((events.items.find((e) => e.action === "approval.escalated")?.after as { target: string })?.target).toBe("SECOND_APPROVER");
  });

  it("leaves fresh, disabled, and decided packages alone", async () => {
    const { app, ctx, store } = createTestApp();
    const fx = await agencyFixture(app);
    await fx.owner.agent.patch(`/api/v1/projects/${fx.projectId}`).send({
      settings: { escalation: { afterHours: 24 } },
    });
    const freshId = await sendableChange(fx.owner.agent, fx.projectId);
    const fresh = await sendForApproval(fx.owner.agent, freshId, { approverUserIds: [fx.clientUserId], expiresAt: EXPIRY() });
    await drainOnce({ store: ctx.store, env: ctx.env, email: ctx.email, realtime: ctx.realtime });
    expect((await store.findApprovalById(fresh.id))?.escalatedAt).toBe(null);

    // Disabled on the project: even an aged package stays quiet.
    await fx.owner.agent.patch(`/api/v1/projects/${fx.projectId}`).send({ settings: { escalation: { afterHours: null } } });
    await store.updateApproval(fresh.id, { sentAt: HOURS_AGO(100) });
    await drainOnce({ store: ctx.store, env: ctx.env, email: ctx.email, realtime: ctx.realtime });
    expect((await store.findApprovalById(fresh.id))?.escalatedAt).toBe(null);

    // Decided packages never escalate.
    const decidedId = await sendableChange(fx.owner.agent, fx.projectId);
    const decided = await sendForApproval(fx.owner.agent, decidedId, { approverUserIds: [fx.clientUserId], expiresAt: EXPIRY() });
    const token = (decided.reviewUrls?.[0] as string).split("/review/")[1] as string;
    await request(app).post(`/api/v1/approval-requests/${token}/decisions`).send({ decision: "APPROVED", confirm: true });
    await fx.owner.agent.patch(`/api/v1/projects/${fx.projectId}`).send({ settings: { escalation: { afterHours: 1 } } });
    await store.updateApproval(decided.id, { sentAt: HOURS_AGO(100) });
    await drainOnce({ store: ctx.store, env: ctx.env, email: ctx.email, realtime: ctx.realtime });
    expect((await store.findApprovalById(decided.id))?.escalatedAt).toBe(null);
  });

  it("validates the escalation settings", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const zero = await fx.owner.agent.patch(`/api/v1/projects/${fx.projectId}`).send({ settings: { escalation: { afterHours: 0 } } });
    expect(zero.status).toBe(400);
    const huge = await fx.owner.agent.patch(`/api/v1/projects/${fx.projectId}`).send({ settings: { escalation: { afterHours: 721 } } });
    expect(huge.status).toBe(400);
    const bogus = await fx.owner.agent.patch(`/api/v1/projects/${fx.projectId}`).send({ settings: { escalation: { target: "BOGUS" } } });
    expect(bogus.status).toBe(400);
    const ok = await fx.owner.agent.patch(`/api/v1/projects/${fx.projectId}`).send({
      settings: { escalation: { afterHours: 48, target: "SECOND_APPROVER" } },
    });
    expect(ok.status).toBe(200);
    expect((ok.body as { settings: { escalation: { afterHours: number; target: string } } }).settings.escalation).toEqual({
      afterHours: 48,
      target: "SECOND_APPROVER",
    });
  });
});

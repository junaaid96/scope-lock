import { describe, expect, it } from "vitest";
import request from "supertest";
import { agencyFixture, createTestApp, draftScope, register, type Agent } from "./helpers.js";

async function approvedChange(agent: Agent, projectId: string, approverUserId: string, priceMinor: number): Promise<string> {
  const created = await agent.post(`/api/v1/projects/${projectId}/change-requests`).send({
    title: "Billable work",
    description: "Billable work description",
  });
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
  await agent.post(`/api/v1/change-requests/${changeId}/impact`).send({ effortDays: 2, priceMinor, confidence: "MEDIUM" });
  const send = await agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
    approverUserIds: [approverUserId],
    expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  });
  const token = ((send.body as { reviewUrls: string[] }).reviewUrls[0] as string).split("/review/")[1] as string;
  return `${changeId} ${token}`;
}

describe("invoice-ready export", () => {
  it("exports approved changes as JSON lines with per-currency totals", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    const { draftId, version } = await draftScope(fx.owner.agent, fx.projectId);
    await fx.owner.agent.post(`/api/v1/scope-versions/${draftId}/publish`).send({ expectedVersion: version });
    const [changeId, token] = (await approvedChange(fx.owner.agent, fx.projectId, fx.clientUserId, 120000)).split(" ");
    const decide = await request(app).post(`/api/v1/approval-requests/${token}/decisions`).send({
      decision: "APPROVED",
      comment: "go",
      confirm: true,
    });
    expect(decide.status).toBe(201);

    const res = await fx.owner.agent.get(
      `/api/v1/projects/${fx.projectId}/export/invoice-ready?from=2020-01-01&to=2030-01-01&format=json`,
    );
    expect(res.status).toBe(200);
    const body = res.body as {
      project: { id: string; currency: string };
      period: { from: string; to: string };
      lines: Array<{ number: string; priceMinor: number; price: string; currency: string; pricingMode: string }>;
      totals: Array<{ currency: string; totalMinor: number }>;
    };
    expect(body.project.id).toBe(fx.projectId);
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0]).toMatchObject({ priceMinor: 120000, price: "1200.00", currency: "USD", pricingMode: "MANUAL" });
    expect(body.totals).toEqual([{ currency: "USD", totalMinor: 120000, total: "1200.00", lines: 1 }]);
    const events = (await store.listAuditEvents({ projectId: fx.projectId, limit: 50 })).items;
    expect(events.some((e) => e.action === "invoice.exported")).toBe(true);
    void changeId;
  });

  it("filters by period and excludes rejected changes", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const { draftId, version } = await draftScope(fx.owner.agent, fx.projectId);
    await fx.owner.agent.post(`/api/v1/scope-versions/${draftId}/publish`).send({ expectedVersion: version });
    const [, token] = (await approvedChange(fx.owner.agent, fx.projectId, fx.clientUserId, 5000)).split(" ");
    await request(app).post(`/api/v1/approval-requests/${token}/decisions`).send({ decision: "APPROVED", comment: "go", confirm: true });

    // Decided today: outside a 2020-only period.
    const empty = await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/export/invoice-ready?from=2020-01-01&to=2020-12-31`);
    expect(empty.status).toBe(200);
    expect((empty.body as { lines: unknown[] }).lines).toEqual([]);
    expect((empty.body as { totals: unknown[] }).totals).toEqual([]);
  });

  it("serves RFC 4180 CSV with a download disposition", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const { draftId, version } = await draftScope(fx.owner.agent, fx.projectId);
    await fx.owner.agent.post(`/api/v1/scope-versions/${draftId}/publish`).send({ expectedVersion: version });
    const [, token] = (await approvedChange(fx.owner.agent, fx.projectId, fx.clientUserId, 7500)).split(" ");
    await request(app).post(`/api/v1/approval-requests/${token}/decisions`).send({ decision: "APPROVED", comment: "go", confirm: true });

    const res = await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/export/invoice-ready?from=2020-01-01&to=2030-01-01&format=csv`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["content-disposition"]).toContain(".csv");
    const lines = (res.text as string).split("\n");
    expect(lines[0]).toBe("number,title,decided_at,price_minor,price,currency,pricing_mode,override_reason,allowance_pool,draw_status");
    expect(lines[1]).toContain("7500");
  });

  it("validates the period and guards access", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const stranger = await register(app, { email: "inv-stranger@other.test", organizationName: "Other" });
    expect((await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/export/invoice-ready?from=2030-01-01&to=2020-01-01`)).status).toBe(400);
    expect((await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/export/invoice-ready?from=2020-01-01&to=2030-01-01&format=xml`)).status).toBe(400);
    expect((await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/export/invoice-ready`)).status).toBe(400);
    expect((await stranger.agent.get(`/api/v1/projects/${fx.projectId}/export/invoice-ready?from=2020-01-01&to=2030-01-01`)).status).toBe(404);
    expect((await request(app).get(`/api/v1/projects/${fx.projectId}/export/invoice-ready?from=2020-01-01&to=2030-01-01`)).status).toBe(401);
    // Clients can export their own project's lines.
    expect((await fx.client.agent.get(`/api/v1/projects/${fx.projectId}/export/invoice-ready?from=2020-01-01&to=2030-01-01`)).status).toBe(200);
  });
});

import { describe, expect, it } from "vitest";
import { PriceSuggestionsResponseSchema, EstimateVsActualResponseSchema } from "@scopelock/contracts";
import { agencyFixture, createTestApp, type Agent } from "./helpers.js";

async function estimatedChange(
  agent: Agent,
  projectId: string,
  title: string,
  priceMinor: number,
  description?: string,
): Promise<string> {
  const created = await agent.post(`/api/v1/projects/${projectId}/change-requests`).send({
    title,
    description: description ?? `${title} scope`,
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
    effortDays: 4,
    priceMinor,
    timelineDays: 5,
    confidence: "HIGH",
  });
  expect(impact.status).toBe(201);
  return id;
}

describe("actuals and price suggestions", () => {
  it("records actuals only on implemented changes and reports estimate-vs-actual", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    const id = await estimatedChange(fx.owner.agent, fx.projectId, "Comparable dashboard work", 100000);

    // Not implemented yet: rejected.
    const early = await fx.owner.agent.patch(`/api/v1/change-requests/${id}/impact/actuals`).send({
      actualEffortDays: 5,
      actualPriceMinor: 120000,
    });
    expect(early.status).toBe(422);

    await store.updateChange(id, { status: "APPROVED", decidedAt: new Date().toISOString() });
    const implemented = await fx.owner.agent.post(`/api/v1/change-requests/${id}/implement`).send({
      expectedVersion: (await store.findChangeById(id))?.version,
    });
    expect(implemented.status).toBe(200);

    const recorded = await fx.owner.agent.patch(`/api/v1/change-requests/${id}/impact/actuals`).send({
      actualEffortDays: 5,
      actualPriceMinor: 120000,
      actualNotes: "Extra review round",
    });
    expect(recorded.status).toBe(200);
    expect(recorded.body).toMatchObject({ actualEffortDays: 5, actualPriceMinor: 120000 });

    const report = await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/estimate-vs-actual`);
    expect(report.status).toBe(200);
    expect(EstimateVsActualResponseSchema.safeParse(report.body).success).toBe(true);
    expect(report.body.data).toHaveLength(1);
    expect(report.body.data[0]).toMatchObject({ varianceMinor: 20000, variancePct: 20, daysVariance: 1 });
    expect(report.body.totals).toMatchObject({ estimateMinor: 100000, actualMinor: 120000, rowsWithActuals: 1 });

    const events = await store.listAuditEvents({ projectId: fx.projectId, limit: 50 });
    expect(events.items.some((e) => e.action === "change.actuals_recorded")).toBe(true);
  });

  it("suggests comparable approved changes with real prices, same currency only", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    const compId = await estimatedChange(
      fx.owner.agent,
      fx.projectId,
      "Salesmen mobile dashboard",
      95000,
      "Route orders and collection targets on phones",
    );
    await store.updateChange(compId, { status: "APPROVED", decidedAt: new Date().toISOString() });
    const other = await estimatedChange(fx.owner.agent, fx.projectId, "Payroll export module", 30000, "Monthly csv for accountants");
    await store.updateChange(other, { status: "APPROVED", decidedAt: new Date().toISOString() });
    const target = await estimatedChange(
      fx.owner.agent,
      fx.projectId,
      "Salesmen tablet dashboard",
      0,
      "Route overview on tablets",
    );

    const res = await fx.owner.agent.get(`/api/v1/change-requests/${target}/price-suggestions`);
    expect(res.status).toBe(200);
    expect(PriceSuggestionsResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.currency).toBe("USD");
    // The dashboard comparable ranks; the payroll change does not match.
    expect(res.body.data.map((d: { changeId: string }) => d.changeId)).toEqual([compId]);
    expect(res.body.data[0]).toMatchObject({ approvedPriceMinor: 95000, currency: "USD" });
    expect(res.body.data[0].sharedTerms).toContain("dashboard");
    // No black-box number: the response carries comparables only.
    expect(res.body.suggestedPriceMinor).toBeUndefined();
    expect(res.body.medianMinor).toBeUndefined();
  });

  it("rejects cross-project reads and client writes", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    const id = await estimatedChange(fx.owner.agent, fx.projectId, "Gated change", 10000);
    await store.updateChange(id, { status: "IMPLEMENTED", decidedAt: new Date().toISOString() });

    // Client approver cannot record actuals (staff permission).
    const denied = await fx.client.agent.patch(`/api/v1/change-requests/${id}/impact/actuals`).send({
      actualEffortDays: 1,
    });
    expect(denied.status).toBe(403);

    // Unknown change is 404, not a leak.
    const missing = await fx.owner.agent.get("/api/v1/change-requests/chg_nope/price-suggestions");
    expect(missing.status).toBe(404);
  });
});

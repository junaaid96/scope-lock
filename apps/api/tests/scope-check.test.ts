import { describe, expect, it } from "vitest";
import request from "supertest";
import { agencyFixture, createTestApp, draftScope } from "./helpers.js";

describe("pre-submission scope check", () => {
  it("matches intake text against the governing baseline (public, deterministic)", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const { draftId, version } = await draftScope(fx.owner.agent, fx.projectId);
    await fx.owner.agent.post(`/api/v1/scope-versions/${draftId}/publish`).send({ expectedVersion: version });
    const created = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/intake-links`).send({ name: "Form" });
    const token = (created.body as { token: string }).token;

    const check = await request(app).post(`/api/v1/intake/${token}/scope-check`).send({
      title: "Homepage testimonials",
      description: "Add a testimonials carousel to the homepage hero section for social proof.",
    });
    expect(check.status).toBe(200);
    const matches = (check.body as { deterministic: Array<{ requirementId: string; stableKey: string; excerpt: string; matchedTerms: string[] }> }).deterministic;
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0]?.requirementId).toBeTruthy();
    expect(matches[0]?.excerpt).toBeTruthy();
    expect(matches[0]?.matchedTerms.length).toBeGreaterThan(0);
    expect((check.body as { baseline: { sequence: number } }).baseline.sequence).toBe(1);

    // Revoked links cannot probe the baseline.
    const linkId = (created.body as { link: { id: string } }).link.id;
    await fx.owner.agent.post(`/api/v1/intake-links/${linkId}/revoke`).send({});
    expect((await request(app).post(`/api/v1/intake/${token}/scope-check`).send({ title: "x", description: "y" })).status).toBe(404);
  });

  it("returns empty matches without a published baseline", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const created = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/intake-links`).send({ name: "Form" });
    const token = (created.body as { token: string }).token;
    const check = await request(app).post(`/api/v1/intake/${token}/scope-check`).send({
      title: "Anything at all",
      description: "A description long enough to pass validation comfortably.",
    });
    expect(check.status).toBe(200);
    expect((check.body as { deterministic: unknown[] }).deterministic).toEqual([]);
    expect((check.body as { baseline: null }).baseline).toBeNull();
  });

  it("checks in-app with deterministic matches plus an AI analysis record", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const { draftId, version } = await draftScope(fx.owner.agent, fx.projectId);
    await fx.owner.agent.post(`/api/v1/scope-versions/${draftId}/publish`).send({ expectedVersion: version });
    const check = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/ai/scope-check`).send({
      title: "Homepage testimonials",
      description: "Add a testimonials carousel to the homepage hero section for social proof.",
    });
    expect(check.status).toBe(200);
    expect(((check.body as { deterministic: unknown[] }).deterministic).length).toBeGreaterThan(0);
    // No provider key in tests: deterministic matches stand, analysis falls back.
    expect((check.body as { analysis: { status: string; changeRequestId: null } }).analysis.status).toBe("FALLBACK");
    expect((check.body as { analysis: { changeRequestId: null } }).analysis.changeRequestId).toBeNull();
    // Clients without AI access cannot check.
    expect((await fx.client.agent.post(`/api/v1/projects/${fx.projectId}/ai/scope-check`).send({ title: "t", description: "d" })).status).toBe(403);
  });

  it("persists suggestions and logs suggestion-vs-final at triage", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    const { draftId, version } = await draftScope(fx.owner.agent, fx.projectId);
    await fx.owner.agent.post(`/api/v1/scope-versions/${draftId}/publish`).send({ expectedVersion: version });
    const reqs = await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/requirements`);
    const reqId = (reqs.body.data as Array<{ id: string }>)[0]?.id as string;

    // Invented suggestion IDs are rejected.
    const bad = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/change-requests`).send({
      title: "Bad suggestions",
      description: "A description long enough to pass validation comfortably.",
      suggestedRequirementIds: ["req_does_not_exist"],
    });
    expect(bad.status).toBe(422);

    const created = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/change-requests`).send({
      title: "Homepage testimonials",
      description: "Add a testimonials carousel to the homepage hero section for social proof.",
      suggestedRequirementIds: [reqId],
    });
    expect(created.status).toBe(201);
    const changeId = (created.body as { id: string }).id;
    expect((await store.findChangeById(changeId))?.scopeCheckSuggestedIds).toEqual([reqId]);

    const submit = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/submit`).send({
      expectedVersion: (created.body as { version: number }).version,
    });
    const triage = await fx.owner.agent.patch(`/api/v1/change-requests/${changeId}`).send({
      expectedVersion: (submit.body as { version: number }).version,
      status: "TRIAGING",
      classification: "IN_SCOPE",
      classificationRationale: "Covered by the homepage requirement",
    });
    expect(triage.status).toBe(200);
    const metrics = await store.listMetrics(fx.projectId);
    const outcome = metrics.find((m) => m.name === "scope_check.outcome");
    expect(outcome?.properties).toMatchObject({ changeId, suggestedIds: [reqId], classification: "IN_SCOPE" });
  });

  it("carries intake suggestions through to the change", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    const { draftId, version } = await draftScope(fx.owner.agent, fx.projectId);
    await fx.owner.agent.post(`/api/v1/scope-versions/${draftId}/publish`).send({ expectedVersion: version });
    const reqs = await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/requirements`);
    const reqId = (reqs.body.data as Array<{ id: string }>)[0]?.id as string;
    const created = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/intake-links`).send({ name: "Form" });
    const token = (created.body as { token: string }).token;
    const submit = await request(app).post(`/api/v1/intake/${token}/submit`).send({
      title: "Homepage testimonials",
      description: "Add a testimonials carousel to the homepage hero section for social proof.",
      suggestedRequirementIds: [reqId],
    });
    expect(submit.status).toBe(201);
    const changes = await store.listChanges(fx.projectId);
    expect(changes[0]?.scopeCheckSuggestedIds).toEqual([reqId]);
  });
});

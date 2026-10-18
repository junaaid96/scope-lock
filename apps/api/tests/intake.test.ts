import { describe, expect, it } from "vitest";
import request from "supertest";
import { agencyFixture, createTestApp, register } from "./helpers.js";

describe("public intake form", () => {
  it("lets leads create, list, and revoke links", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    const created = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/intake-links`).send({ name: "Website form" });
    expect(created.status).toBe(201);
    const token = (created.body as { token: string }).token;
    expect(token.length).toBeGreaterThan(20);
    expect((created.body as { url: string }).url).toContain(`/intake/${token}`);
    expect(JSON.stringify(created.body)).not.toContain("tokenHash");

    const list = await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/intake-links`);
    expect(list.status).toBe(200);
    expect((list.body as { data: unknown[] }).data).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain("tokenHash");

    // Clients cannot manage links.
    expect((await fx.client.agent.post(`/api/v1/projects/${fx.projectId}/intake-links`).send({ name: "x" })).status).toBe(403);
    expect((await fx.client.agent.get(`/api/v1/projects/${fx.projectId}/intake-links`)).status).toBe(403);

    const linkId = (created.body as { link: { id: string } }).link.id;
    expect((await fx.owner.agent.post(`/api/v1/intake-links/${linkId}/revoke`).send({})).status).toBe(200);
    expect((await store.findIntakeLinkById(linkId))?.revokedAt).not.toBeNull();
    // Revoked links stay dead.
    expect((await request(app).get(`/api/v1/intake/${token}`)).status).toBe(404);
    expect(
      (await request(app).post(`/api/v1/intake/${token}/submit`).send({ title: "Valid title here", description: "A long enough description for validation to pass cleanly." })).status,
    ).toBe(404);
  });

  it("accepts public submissions as unverified SUBMITTED changes", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    const created = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/intake-links`).send({ name: "Website form" });
    const token = (created.body as { token: string }).token;

    const info = await request(app).get(`/api/v1/intake/${token}`);
    expect(info.status).toBe(200);
    expect((info.body as { projectName: string }).projectName).toBeTruthy();
    expect((info.body as { organizationName: string }).organizationName).toBe("Agency");

    const submit = await request(app).post(`/api/v1/intake/${token}/submit`).send({
      title: "Add a booking calendar",
      description: "We need a booking calendar on the contact page so visitors can pick a slot without calling us.",
      submitterName: "Pat Visitor",
      submitterEmail: "pat@example.com",
    });
    expect(submit.status).toBe(201);
    expect((submit.body as { received: boolean }).received).toBe(true);

    const changes = await store.listChanges(fx.projectId);
    expect(changes).toHaveLength(1);
    const change = changes[0] as { status: string; source: string; submitterId: null; unverifiedSubmitter: boolean; submitterEmail: string };
    expect(change.status).toBe("SUBMITTED");
    expect(change.source).toBe("INTAKE_FORM");
    expect(change.submitterId).toBeNull();
    expect(change.unverifiedSubmitter).toBe(true);
    expect(change.submitterEmail).toBe("pat@example.com");

    const events = (await store.listAuditEvents({ projectId: fx.projectId, limit: 50 })).items;
    expect(events.some((e) => e.action === "intake.submitted")).toBe(true);
    const notes = (await store.listNotifications(fx.owner.user.id, {})).items;
    expect(notes.some((n) => n.type === "INTAKE_SUBMITTED")).toBe(true);
  });

  it("silently drops honeypot submissions", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    const created = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/intake-links`).send({ name: "Website form" });
    const token = (created.body as { token: string }).token;
    const submit = await request(app).post(`/api/v1/intake/${token}/submit`).send({
      title: "Cheap SEO services",
      description: "Buy cheap SEO services now, guaranteed rankings in 24 hours or your money back.",
      website: "https://spam.example",
    });
    expect(submit.status).toBe(201);
    expect((submit.body as { received: boolean }).received).toBe(true);
    expect((submit.body as { number?: string }).number).toBeUndefined();
    expect(await store.listChanges(fx.projectId)).toHaveLength(0);
    const metrics = await store.listMetrics(fx.projectId);
    expect(metrics.some((m) => m.name === "intake.honeypot")).toBe(true);
  });

  it("enforces expiry, validation, and source reservation", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    const stranger = await register(app, { email: "intake-stranger@other.test", organizationName: "Other" });

    const expired = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/intake-links`).send({
      name: "Old",
      expiresAt: new Date(Date.now() + 1000).toISOString(),
    });
    const oldToken = (expired.body as { token: string }).token;
    const linkId = (expired.body as { link: { id: string } }).link.id;
    // Expired links report gone.
    await store.updateIntakeLink(linkId, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect((await request(app).get(`/api/v1/intake/${oldToken}`)).status).toBe(410);
    // Revoked links reject submissions.
    await fx.owner.agent.post(`/api/v1/intake-links/${linkId}/revoke`).send({});
    expect(
      (await request(app).post(`/api/v1/intake/${oldToken}/submit`).send({ title: "Valid title here", description: "A long enough description for validation to pass cleanly." })).status,
    ).toBe(404);

    const live = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/intake-links`).send({ name: "Live" });
    const token = (live.body as { token: string }).token;
    // Too short / too long bodies are rejected (size limits).
    expect((await request(app).post(`/api/v1/intake/${token}/submit`).send({ title: "x", description: "short" })).status).toBe(400);
    expect(
      (await request(app).post(`/api/v1/intake/${token}/submit`).send({ title: "ok title here", description: "x".repeat(9000) })).status,
    ).toBe(400);
    // Unknown tokens 404 without leaking which links exist.
    expect((await request(app).get(`/api/v1/intake/${"z".repeat(43)}`)).status).toBe(404);
    // Past expiry is rejected at creation.
    expect(
      (await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/intake-links`).send({ name: "x", expiresAt: "2020-01-01T00:00:00.000Z" })).status,
    ).toBe(422);
    // INTAKE_FORM is reserved for the public path.
    expect(
      (await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/change-requests`).send({ title: "t", description: "d", source: "INTAKE_FORM" })).status,
    ).toBe(422);
    // Outsiders cannot manage links.
    expect((await stranger.agent.get(`/api/v1/projects/${fx.projectId}/intake-links`)).status).toBe(404);
    expect((await stranger.agent.post(`/api/v1/projects/${fx.projectId}/intake-links`).send({ name: "x" })).status).toBe(404);
  });
});

import { describe, expect, it } from "vitest";
import request from "supertest";
import { agencyFixture, createClient, createProject, createTestApp, register } from "./helpers.js";

describe("clients, projects, scope ledger", () => {
  it("manages clients and blocks deletion while projects exist", async () => {
    const { app } = createTestApp();
    const owner = await register(app, { email: "o@test.dev" });
    const client = await createClient(app, owner.agent, owner.organization.id, "Globex");
    const del = await owner.agent.delete(`/api/v1/clients/${client.id}`);
    expect(del.status).toBe(200);

    const client2 = await createClient(app, owner.agent, owner.organization.id, "Initech");
    await createProject(app, owner.agent, { organizationId: owner.organization.id, clientId: client2.id });
    const blocked = await owner.agent.delete(`/api/v1/clients/${client2.id}`);
    expect(blocked.status).toBe(422);
  });

  it("filters the dashboard by access and tracks pending work", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const ownerList = await fx.owner.agent.get(`/api/v1/projects?organizationId=${fx.organizationId}`);
    expect(ownerList.status).toBe(200);
    expect(ownerList.body.data).toHaveLength(1);
    expect(ownerList.body.data[0].myRole).toBe("LEAD");

    const outsider = await register(app, { email: "out@test.dev" });
    const otherClient = await createClient(app, fx.owner.agent, fx.organizationId, "Other");
    const otherProject = await createProject(app, fx.owner.agent, { organizationId: fx.organizationId, clientId: otherClient.id, name: "Hidden" });
    // Remove the client's access to the second project implicitly: they were never added.
    const clientList = await fx.client.agent.get(`/api/v1/projects?organizationId=${fx.organizationId}`);
    expect(clientList.body.data.map((p: { id: string }) => p.id)).toEqual([fx.projectId]);

    const probe = await outsider.agent.get(`/api/v1/projects/${otherProject.id}`);
    expect(probe.status).toBe(404);
    void otherProject;
  });

  it("drafts, publishes, and freezes scope versions", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const draft = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/scope-versions/draft`).send({ title: "v1" });
    expect(draft.status).toBe(201);
    const draftId = draft.body.id as string;

    const second = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/scope-versions/draft`).send({});
    expect(second.status).toBe(409);

    const created = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/requirements`).send({
      draftVersionId: draftId,
      title: "Homepage",
      description: "Marketing homepage",
      acceptanceCriteria: ["Loads fast"],
    });
    expect(created.status).toBe(201);
    expect(created.body.requirement.stableKey).toBe("REQ-001");

    const loaded = await fx.owner.agent.get(`/api/v1/scope-versions/${draftId}`);
    expect(loaded.body.revisions).toHaveLength(1);

    const published = await fx.owner.agent.post(`/api/v1/scope-versions/${draftId}/publish`).send({
      expectedVersion: loaded.body.version as number,
    });
    expect(published.status).toBe(200);
    expect(published.body.status).toBe("PUBLISHED");
    expect(published.body.sequence).toBe(1);

    // Published versions are immutable.
    const edit = await fx.owner.agent.patch(`/api/v1/scope-versions/${draftId}`).send({ expectedVersion: 99, title: "hack" });
    expect(edit.status).toBe(409);
    const addAfter = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/requirements`).send({
      draftVersionId: draftId,
      title: "Late",
      description: "Too late",
    });
    expect(addAfter.status).toBe(409);

    // Amendment creates a newer version; the old one stays reconstructible.
    const draft2 = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/scope-versions/draft`).send({
      copyFromVersionId: draftId,
      title: "v2",
    });
    expect(draft2.status).toBe(201);
    const revs = await fx.owner.agent.get(`/api/v1/scope-versions/${draft2.body.id as string}`);
    expect(revs.body.revisions).toHaveLength(1);

    // RULE4: an amendment needs a linked APPROVED change — direct publish is blocked.
    const blocked = await fx.owner.agent.post(`/api/v1/scope-versions/${draft2.body.id as string}/publish`).send({
      expectedVersion: revs.body.version as number,
    });
    expect(blocked.status).toBe(422);

    // Drive a change to APPROVED and link it to the manual draft.
    const ch = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/change-requests`).send({
      title: "Add blog",
      description: "Add a blog section",
      source: "AGENCY",
    });
    const changeId = ch.body.id as string;
    let cv = ch.body.version as number;
    for (const status of ["SUBMITTED", "TRIAGING", "ESTIMATING"]) {
      const res = await fx.owner.agent.patch(`/api/v1/change-requests/${changeId}`).send({ expectedVersion: cv, status });
      cv = res.body.version as number;
    }
    await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/impact`).send({ effortDays: 1, priceMinor: 5000, confidence: "MEDIUM" });
    const sendRes = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(sendRes.status).toBe(201);
    const tok = ((sendRes.body as { reviewUrls: string[] }).reviewUrls[0] as string).split("/review/")[1] as string;
    const dec = await request(app).post(`/api/v1/approval-requests/${tok}/decisions`).send({
      decision: "APPROVED",
      comment: "Ship it",
      confirm: true,
    });
    expect(dec.status).toBe(201);
    const linked = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/convert-to-scope`).send({
      scopeVersionId: draft2.body.id,
    });
    expect(linked.status).toBe(200);

    const publish2 = await fx.owner.agent.post(`/api/v1/scope-versions/${draft2.body.id as string}/publish`).send({
      expectedVersion: revs.body.version as number,
    });
    expect(publish2.status).toBe(200);
    expect(publish2.body.sequence).toBe(2);
    const old = await fx.owner.agent.get(`/api/v1/scope-versions/${draftId}`);
    expect(old.body.status).toBe("SUPERSEDED");
    expect(old.body.revisions).toHaveLength(1);
  });

  it("rejects empty publishes and stale draft writes", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const draft = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/scope-versions/draft`).send({});
    const empty = await fx.owner.agent.post(`/api/v1/scope-versions/${draft.body.id as string}/publish`).send({ expectedVersion: 0 });
    expect(empty.status).toBe(422);

    const stale = await fx.owner.agent.patch(`/api/v1/scope-versions/${draft.body.id as string}`).send({
      expectedVersion: 99,
      title: "x",
    });
    expect(stale.status).toBe(409);
  });

  it("diffs two versions at field level", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const d1 = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/scope-versions/draft`).send({});
    const d1Id = d1.body.id as string;
    const req = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/requirements`).send({
      draftVersionId: d1Id,
      title: "Homepage",
      description: "v1 text",
    });
    const v1 = await fx.owner.agent.get(`/api/v1/scope-versions/${d1Id}`);
    await fx.owner.agent.post(`/api/v1/scope-versions/${d1Id}/publish`).send({ expectedVersion: v1.body.version });

    const d2 = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/scope-versions/draft`).send({ copyFromVersionId: d1Id });
    const d2Id = d2.body.id as string;
    const reqId = (req.body as { requirement: { id: string } }).requirement.id;
    const d2v = await fx.owner.agent.get(`/api/v1/scope-versions/${d2Id}`);
    await fx.owner.agent.post(`/api/v1/scope-versions/${d2Id}/requirements`).send({
      requirementId: reqId,
      expectedVersion: d2v.body.version,
      title: "Homepage + testimonials",
    });
    await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/requirements`).send({
      draftVersionId: d2Id,
      title: "Blog",
      description: "New section",
    });
    const diff = await fx.owner.agent.get(`/api/v1/scope-versions/${d1Id}/diff/${d2Id}`);
    expect(diff.status).toBe(200);
    expect(diff.body.diff.added).toHaveLength(1);
    expect(diff.body.diff.removed).toHaveLength(0);
    expect(diff.body.diff.modified).toHaveLength(1);
    expect(diff.body.diff.modified[0].changes[0].field).toBe("title");
  });

  it("tracks requirement status transitions with audit", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const d1 = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/scope-versions/draft`).send({});
    const req = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/requirements`).send({
      draftVersionId: d1.body.id,
      title: "Homepage",
      description: "desc",
    });
    const reqId = (req.body as { requirement: { id: string } }).requirement.id;
    // PROPOSED -> ACCEPTED is an illegal jump.
    const jump = await fx.owner.agent.patch(`/api/v1/requirements/${reqId}`).send({ status: "ACCEPTED" });
    expect(jump.status).toBe(409);
    const ok = await fx.owner.agent.patch(`/api/v1/requirements/${reqId}`).send({ status: "AGREED" });
    expect(ok.status).toBe(200);
    // Client cannot change requirement status.
    const clientTry = await fx.client.agent.patch(`/api/v1/requirements/${reqId}`).send({ status: "IN_PROGRESS" });
    expect(clientTry.status).toBe(403);
  });

  it("manages project members with least privilege", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    // Client approver cannot add members.
    const denied = await fx.client.agent.post(`/api/v1/projects/${fx.projectId}/members`).send({
      email: "stranger@test.dev",
      role: "CLIENT_VIEWER",
    });
    expect(denied.status).toBe(403);
    // Unknown users must be invited first.
    const unknown = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/members`).send({
      email: "ghost@test.dev",
      role: "CLIENT_VIEWER",
    });
    expect(unknown.status).toBe(422);
    const members = await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/members`);
    expect(members.body.data).toHaveLength(2);
  });
});

import { describe, expect, it } from "vitest";
import request from "supertest";
import { agencyFixture, createTestApp, draftScope } from "./helpers.js";

async function publishedBaseline(agent: { post: (...a: never[]) => never }, _projectId: string): Promise<void> {
  void agent;
  void _projectId;
}

describe("change requests + approvals", () => {
  it("runs the complete submit → decide → implement loop", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const { draftId, version } = await draftScope(fx.owner.agent, fx.projectId);
    await fx.owner.agent.post(`/api/v1/scope-versions/${draftId}/publish`).send({ expectedVersion: version });
    void publishedBaseline;

    // Client submits.
    const created = await fx.client.agent.post(`/api/v1/projects/${fx.projectId}/change-requests`).send({
      title: "Add testimonials",
      description: "Add a testimonials carousel to the homepage for social proof.",
    });
    expect(created.status).toBe(201);
    const changeId = created.body.id as string;
    let versionNow = created.body.version as number;

    const submit = await fx.client.agent.post(`/api/v1/change-requests/${changeId}/submit`).send({ expectedVersion: versionNow });
    expect(submit.body.status).toBe("SUBMITTED");
    versionNow = submit.body.version as number;

    // Client cannot triage.
    const clientTriage = await fx.client.agent.patch(`/api/v1/change-requests/${changeId}`).send({
      expectedVersion: versionNow,
      status: "TRIAGING",
    });
    expect(clientTriage.status).toBe(403);

    // Lead triages → estimating.
    for (const status of ["TRIAGING", "ESTIMATING"]) {
      const res = await fx.owner.agent.patch(`/api/v1/change-requests/${changeId}`).send({
        expectedVersion: versionNow,
        status,
        ...(status === "TRIAGING" ? { classification: "POTENTIAL_CHANGE", classificationRationale: "New section, not in baseline" } : {}),
      });
      expect(res.status).toBe(200);
      versionNow = res.body.version as number;
    }

    // Link to the baseline requirement + record impact.
    const reqs = await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/requirements`);
    const reqId = (reqs.body.data as Array<{ id: string }>)[0]?.id as string;
    const link = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/links`).send({
      targetType: "REQUIREMENT",
      targetRequirementId: reqId,
      kind: "AFFECTS",
    });
    expect(link.status).toBe(201);
    const detail1 = await fx.owner.agent.get(`/api/v1/change-requests/${changeId}`);
    versionNow = (detail1.body as { version: number }).version;

    const impact = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/impact`).send({
      effortDays: 2,
      priceMinor: 120000,
      timelineDays: 3,
      risks: ["Copy delay"],
      confidence: "HIGH",
    });
    expect(impact.status).toBe(201);

    const ready = await fx.owner.agent.get(`/api/v1/change-requests/${changeId}`);
    expect((ready.body as { sendBlockers: string[] }).sendBlockers).toEqual([]);

    // Incomplete proposal is blocked: tested separately below; here send succeeds.
    const send = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });
    expect(send.status).toBe(201);
    const reviewUrl = ((send.body as { reviewUrls: string[] }).reviewUrls[0] as string);
    const token = reviewUrl.split("/review/")[1] as string;
    void versionNow;

    // Public review package renders with the exact snapshot + checksum.
    const review = await request(app).get(`/api/v1/approval-requests/${token}`);
    expect(review.status).toBe(200);
    expect(review.body.package.request.title).toBe("Add testimonials");
    expect(review.body.package.impact.priceMinor).toBe(120000);
    expect(review.body.checksum).toBeTruthy();

    // Reject without comment fails; approve succeeds.
    const noComment = await request(app).post(`/api/v1/approval-requests/${token}/decisions`).send({
      decision: "REJECTED",
      confirm: true,
    });
    expect(noComment.status).toBe(422);
    const decide = await request(app).post(`/api/v1/approval-requests/${token}/decisions`).send({
      decision: "APPROVED",
      comment: "Go ahead",
      confirm: true,
    });
    expect(decide.status).toBe(201);
    expect(decide.body.checksum).toBe(review.body.checksum);

    // First decision wins.
    const replay = await request(app).post(`/api/v1/approval-requests/${token}/decisions`).send({
      decision: "REJECTED",
      comment: "changed mind",
      confirm: true,
    });
    expect(replay.status).toBe(409);

    const decided = await fx.owner.agent.get(`/api/v1/change-requests/${changeId}`);
    expect((decided.body as { status: string }).status).toBe("APPROVED");

    // Convert to amendment + publish explicitly, then implement.
    const convert = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/convert-to-scope`).send({});
    expect(convert.status).toBe(201);
    const amendment = await fx.owner.agent.get(`/api/v1/scope-versions/${convert.body.id as string}`);
    const publishAmend = await fx.owner.agent.post(`/api/v1/scope-versions/${convert.body.id as string}/publish`).send({
      expectedVersion: (amendment.body as { version: number }).version,
    });
    expect(publishAmend.status).toBe(200);

    const implDetail = await fx.owner.agent.get(`/api/v1/change-requests/${changeId}`);
    const impl = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/implement`).send({
      expectedVersion: (implDetail.body as { version: number }).version,
    });
    expect(impl.body.status).toBe("IMPLEMENTED");
  });

  it("blocks incomplete proposals from being sent", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const created = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/change-requests`).send({
      title: "Half-baked",
      description: "Not ready",
      source: "AGENCY",
    });
    const send = await fx.owner.agent.post(`/api/v1/change-requests/${created.body.id as string}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(send.status).toBe(422);
    expect((send.body.error.details as { blockers: string[] }).blockers.length).toBeGreaterThan(0);
  });

  it("invalidates pending approvals on material edits", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const created = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/change-requests`).send({
      title: "Edit me",
      description: "v1",
      source: "AGENCY",
    });
    const changeId = created.body.id as string;
    let v = created.body.version as number;
    for (const status of ["SUBMITTED", "TRIAGING", "ESTIMATING"]) {
      const res = await fx.owner.agent.patch(`/api/v1/change-requests/${changeId}`).send({ expectedVersion: v, status });
      v = res.body.version as number;
    }
    await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/impact`).send({ effortDays: 1, priceMinor: 5000, confidence: "LOW" });
    const send = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(send.status).toBe(201);

    const detail = await fx.owner.agent.get(`/api/v1/change-requests/${changeId}`);
    const edit = await fx.owner.agent.patch(`/api/v1/change-requests/${changeId}`).send({
      expectedVersion: (detail.body as { version: number }).version,
      description: "v2 — scope grew",
    });
    expect(edit.status).toBe(200);
    const after = await fx.owner.agent.get(`/api/v1/change-requests/${changeId}`);
    expect((after.body as { status: string }).status).toBe("ESTIMATING");
    expect(((after.body as { approvals: Array<{ status: string }> }).approvals[0] as { status: string }).status).toBe("INVALIDATED");

    // The old review link can no longer decide.
    const token = ((send.body as { reviewUrls: string[] }).reviewUrls[0] as string).split("/review/")[1] as string;
    const decide = await request(app).post(`/api/v1/approval-requests/${token}/decisions`).send({ decision: "APPROVED", confirm: true });
    expect(decide.status).toBe(409);
  });

  it("supports clarifications, notes, bundles, and dependencies", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const mk = async (title: string): Promise<string> => {
      const res = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/change-requests`).send({ title, description: `${title} desc`, source: "AGENCY" });
      return res.body.id as string;
    };
    const a = await mk("Alpha");
    const b = await mk("Beta");
    for (const id of [a, b]) {
      let v = ((await fx.owner.agent.get(`/api/v1/change-requests/${id}`)).body as { version: number }).version;
      for (const status of ["SUBMITTED", "TRIAGING", "ESTIMATING"]) {
        const res = await fx.owner.agent.patch(`/api/v1/change-requests/${id}`).send({ expectedVersion: v, status });
        v = res.body.version as number;
      }
      await fx.owner.agent.post(`/api/v1/change-requests/${id}/impact`).send({ effortDays: 1, priceMinor: 10000, confidence: "MEDIUM" });
    }
    // Dependency: Beta needs Alpha approved.
    const dep = await fx.owner.agent.post(`/api/v1/change-requests/${b}/links`).send({
      targetType: "CHANGE",
      targetChangeId: a,
      kind: "DEPENDS_ON",
      condition: "PREREQ_APPROVED",
    });
    expect(dep.status).toBe(201);
    const bDetail = await fx.owner.agent.get(`/api/v1/change-requests/${b}`);
    expect(((bDetail.body as { sendBlockers: string[] }).sendBlockers.join(" "))).toMatch(/Dependency not satisfied/);

    // Bundle them: bundle send is blocked until every member is unblocked.
    const bundle = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/bundles`).send({
      name: "Q1 bundle",
      changeRequestIds: [a, b],
      adjustmentMinor: -1000,
      adjustmentNote: "Combined discount",
    });
    expect(bundle.status).toBe(201);
    const bundleId = bundle.body.id as string;
    const bundleView = await fx.owner.agent.get(`/api/v1/bundles/${bundleId}`);
    expect(bundleView.body.combined.priceMinor).toBe(19000);
    expect(bundleView.body.sendBlockers.length).toBeGreaterThan(0);

    // Clarification round-trip.
    const q = await fx.owner.agent.post(`/api/v1/change-requests/${a}/clarifications`).send({ question: "Which pages?" });
    expect(q.status).toBe(201);
    const ans = await fx.client.agent.post(`/api/v1/change-requests/${a}/clarifications/${q.body.id as string}/answer`).send({ answer: "Homepage only" });
    expect(ans.status).toBe(200);

    // Decision note with edit history.
    const note = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/decision-notes`).send({
      targetType: "CHANGE",
      targetId: a,
      body: "Client prefers phased delivery.",
    });
    expect(note.status).toBe(201);
    const edited = await fx.owner.agent.patch(`/api/v1/decision-notes/${note.body.id as string}`).send({ body: "Client prefers phased delivery (confirmed). " });
    expect(edited.body.editHistory).toHaveLength(1);
  });

  it("re-checks approval dependencies at decision time", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const mk = async (title: string): Promise<string> => {
      const res = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/change-requests`).send({ title, description: `${title} desc`, source: "AGENCY" });
      return res.body.id as string;
    };
    const toEstimating = async (id: string): Promise<void> => {
      let v = ((await fx.owner.agent.get(`/api/v1/change-requests/${id}`)).body as { version: number }).version;
      for (const status of ["SUBMITTED", "TRIAGING", "ESTIMATING"]) {
        const res = await fx.owner.agent.patch(`/api/v1/change-requests/${id}`).send({ expectedVersion: v, status });
        v = res.body.version as number;
      }
      await fx.owner.agent.post(`/api/v1/change-requests/${id}/impact`).send({ effortDays: 1, priceMinor: 10000, confidence: "MEDIUM" });
    };
    const sendAndToken = async (id: string): Promise<string> => {
      const sent = await fx.owner.agent.post(`/api/v1/change-requests/${id}/approval-requests`).send({
        approverUserIds: [fx.clientUserId],
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      });
      expect(sent.status).toBe(201);
      return ((sent.body as { reviewUrls: string[] }).reviewUrls[0] as string).split("/review/")[1] as string;
    };
    const a = await mk("Prereq");
    const b = await mk("Dependent");
    await toEstimating(a);
    await toEstimating(b);
    const dep = await fx.owner.agent.post(`/api/v1/change-requests/${b}/links`).send({
      targetType: "CHANGE",
      targetChangeId: a,
      kind: "DEPENDS_ON",
      condition: "PREREQ_APPROVED",
    });
    expect(dep.status).toBe(201);
    // Approve the prerequisite, then send the dependent while deps are satisfied.
    const tokenA = await sendAndToken(a);
    const decideA = await request(app).post(`/api/v1/approval-requests/${tokenA}/decisions`).send({ decision: "APPROVED", confirm: true });
    expect(decideA.status).toBe(201);
    const tokenB = await sendAndToken(b);
    // The prerequisite regresses (APPROVED -> WITHDRAWN) before the decision.
    const aDetail = await fx.owner.agent.get(`/api/v1/change-requests/${a}`);
    const withdrawn = await fx.owner.agent.patch(`/api/v1/change-requests/${a}`).send({
      expectedVersion: (aDetail.body as { version: number }).version,
      status: "WITHDRAWN",
    });
    expect(withdrawn.status).toBe(200);
    const decideB = await request(app).post(`/api/v1/approval-requests/${tokenB}/decisions`).send({ decision: "APPROVED", confirm: true });
    expect(decideB.status).toBe(409);
    expect(JSON.stringify(decideB.body)).toMatch(/Dependency not satisfied/);
  });

  it("traces invalidations to the originating request", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    const created = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/change-requests`).send({
      title: "Trace me",
      description: "v1",
      source: "AGENCY",
    });
    const changeId = created.body.id as string;
    let v = created.body.version as number;
    for (const status of ["SUBMITTED", "TRIAGING", "ESTIMATING"]) {
      const res = await fx.owner.agent.patch(`/api/v1/change-requests/${changeId}`).send({ expectedVersion: v, status });
      v = res.body.version as number;
    }
    await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/impact`).send({ effortDays: 1, priceMinor: 5000, confidence: "LOW" });
    await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const detail = await fx.owner.agent.get(`/api/v1/change-requests/${changeId}`);
    const edit = await fx.owner.agent.patch(`/api/v1/change-requests/${changeId}`).send({
      expectedVersion: (detail.body as { version: number }).version,
      description: "v2 — scope grew",
    });
    expect(edit.status).toBe(200);
    const requestId = edit.headers["x-request-id"] as string;
    expect(requestId).toBeTruthy();
    const events = await store.listAuditEvents({ projectId: fx.projectId, limit: 50 });
    const inv = events.items.find((e) => e.action === "approval.invalidated");
    expect(inv?.correlationId).toBe(requestId);
  });

  it("serves the client decision inbox and approval history", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const created = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/change-requests`).send({
      title: "Inbox item",
      description: "desc",
      source: "AGENCY",
    });
    const changeId = created.body.id as string;
    let v = created.body.version as number;
    for (const status of ["SUBMITTED", "TRIAGING", "ESTIMATING"]) {
      const res = await fx.owner.agent.patch(`/api/v1/change-requests/${changeId}`).send({ expectedVersion: v, status });
      v = res.body.version as number;
    }
    await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/impact`).send({ effortDays: 1, priceMinor: 100, confidence: "LOW" });
    await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const inbox = await fx.client.agent.get("/api/v1/inbox");
    expect(inbox.status).toBe(200);
    expect(inbox.body.data).toHaveLength(1);
    const ownerInbox = await fx.owner.agent.get("/api/v1/inbox");
    expect(ownerInbox.body.data).toHaveLength(0);
    const list = await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/approval-requests`);
    expect(list.body.data).toHaveLength(1);
  });
});

import { describe, expect, it } from "vitest";
import request from "supertest";
import { agencyFixture, createTestApp, type Agent } from "./helpers.js";

const EXPIRY = (): string => new Date(Date.now() + 7 * 86_400_000).toISOString();

async function estimatingChange(agent: Agent, projectId: string, title: string): Promise<{ id: string; version: number }> {
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
  return { id, version: v };
}

const option = (label: string, priceMinor: number) => ({
  label,
  description: `${label} variant`,
  effortDays: 3,
  priceMinor,
  timelineDays: 5,
});

function tokensOf(sendBody: unknown): string[] {
  return ((sendBody as { reviewUrls: string[] }).reviewUrls ?? []).map((u) => u.split("/review/")[1] as string);
}

describe("proposal options", () => {
  it("manages options with labels, caps, currency, versions, and roles", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const ch = await estimatingChange(fx.owner.agent, fx.projectId, "Optioned work");

    const a = await fx.owner.agent.post(`/api/v1/change-requests/${ch.id}/options`).send(option("Full", 200000));
    expect(a.status).toBe(201);
    const b = await fx.owner.agent.post(`/api/v1/change-requests/${ch.id}/options`).send(option("Reduced", 80000));
    expect(b.status).toBe(201);

    const dup = await fx.owner.agent.post(`/api/v1/change-requests/${ch.id}/options`).send(option("  full ", 1000));
    expect(dup.status).toBe(409);
    const wrongMoney = await fx.owner.agent.post(`/api/v1/change-requests/${ch.id}/options`).send({
      ...option("Defer", 1000),
      currency: "EUR",
    });
    expect(wrongMoney.status).toBe(422);
    for (const label of ["Defer", "Phased"]) {
      const extra = await fx.owner.agent.post(`/api/v1/change-requests/${ch.id}/options`).send(option(label, 1000));
      expect(extra.status).toBe(201);
    }
    const fifth = await fx.owner.agent.post(`/api/v1/change-requests/${ch.id}/options`).send(option("Extra", 1000));
    expect(fifth.status).toBe(422);

    const stale = await fx.owner.agent.patch(`/api/v1/change-requests/${ch.id}/options/${a.body.id as string}`).send({
      expectedVersion: 99,
      label: "Fuller",
    });
    expect(stale.status).toBe(409);
    const rename = await fx.owner.agent.patch(`/api/v1/change-requests/${ch.id}/options/${a.body.id as string}`).send({
      expectedVersion: 0,
      label: "Full scope",
    });
    expect(rename.status).toBe(200);
    expect(rename.body.label).toBe("Full scope");

    // Stranger's option id on this change: opaque not-found.
    const ghost = await fx.owner.agent.patch(`/api/v1/change-requests/${ch.id}/options/opt_nope`).send({
      expectedVersion: 0,
      label: "Ghost",
    });
    expect(ghost.status).toBe(404);

    const del = await fx.owner.agent.delete(`/api/v1/change-requests/${ch.id}/options/${b.body.id as string}`);
    expect(del.status).toBe(204);

    // Client approver cannot author options.
    const rogue = await fx.client.agent.post(`/api/v1/change-requests/${ch.id}/options`).send(option("Rogue", 1));
    expect(rogue.status).toBe(403);

    const detail = await fx.owner.agent.get(`/api/v1/change-requests/${ch.id}`);
    expect((detail.body as { options: unknown[] }).options).toHaveLength(3);
  });

  it("sends on options alone and requires the client to pick exactly one", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    const ch = await estimatingChange(fx.owner.agent, fx.projectId, "Pick one");

    const full = await fx.owner.agent.post(`/api/v1/change-requests/${ch.id}/options`).send(option("Full", 200000));
    const reduced = await fx.owner.agent.post(`/api/v1/change-requests/${ch.id}/options`).send(option("Reduced", 80000));
    const fullId = full.body.id as string;
    const reducedId = reduced.body.id as string;

    const send = await fx.owner.agent.post(`/api/v1/change-requests/${ch.id}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(),
    });
    expect(send.status).toBe(201);
    const pkg = (send.body.approval as { package: { options: Array<{ optionId: string; label: string; priceMinor: number }> } }).package;
    expect(pkg.options.map((o) => o.label).sort()).toEqual(["Full", "Reduced"]);
    expect(pkg.options.find((o) => o.optionId === fullId)?.priceMinor).toBe(200000);
    const [token] = tokensOf(send.body);

    const review = await request(app).get(`/api/v1/approval-requests/${token}`);
    expect(review.body.package.options).toHaveLength(2);

    // Approve without a pick, or with an invented id: rejected.
    const nopick = await request(app).post(`/api/v1/approval-requests/${token}/decisions`).send({
      decision: "APPROVED",
      confirm: true,
    });
    expect(nopick.status).toBe(422);
    const invented = await request(app).post(`/api/v1/approval-requests/${token}/decisions`).send({
      decision: "APPROVED",
      optionId: "opt_invented",
      confirm: true,
    });
    expect(invented.status).toBe(422);

    const decide = await request(app).post(`/api/v1/approval-requests/${token}/decisions`).send({
      decision: "APPROVED",
      optionId: reducedId,
      comment: "Reduced is enough for now",
      confirm: true,
    });
    expect(decide.status).toBe(201);
    expect(decide.body.outcome.state).toBe("APPROVED");

    // The pick drives the record: latest impact prices the chosen option.
    const impact = await store.findLatestImpact(ch.id);
    expect(impact?.priceMinor).toBe(80000);
    expect(impact?.notes).toMatch(/Chosen option "Reduced"/);
    const approval = await store.findApprovalById((send.body.approval as { id: string }).id);
    expect(approval?.chosenOptionId).toBe(reducedId);
    const done = await fx.owner.agent.get(`/api/v1/change-requests/${ch.id}`);
    expect((done.body as { status: string }).status).toBe("APPROVED");

    // Options freeze once decided.
    const frozen = await fx.owner.agent.post(`/api/v1/change-requests/${ch.id}/options`).send(option("Late", 1));
    expect(frozen.status).toBe(422);
  });

  it("rejects cleanly with or without options, but never with a pick attached", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const ch = await estimatingChange(fx.owner.agent, fx.projectId, "No thanks");
    await fx.owner.agent.post(`/api/v1/change-requests/${ch.id}/options`).send(option("Full", 200000));
    const reduced = await fx.owner.agent.post(`/api/v1/change-requests/${ch.id}/options`).send(option("Reduced", 80000));
    const send = await fx.owner.agent.post(`/api/v1/change-requests/${ch.id}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(),
    });
    const [token] = tokensOf(send.body);

    const pickAndReject = await request(app).post(`/api/v1/approval-requests/${token}/decisions`).send({
      decision: "REJECTED",
      comment: "No",
      optionId: reduced.body.id as string,
      confirm: true,
    });
    expect(pickAndReject.status).toBe(422);

    const reject = await request(app).post(`/api/v1/approval-requests/${token}/decisions`).send({
      decision: "REJECTED",
      comment: "Not this quarter",
      confirm: true,
    });
    expect(reject.status).toBe(201);
    const done = await fx.owner.agent.get(`/api/v1/change-requests/${ch.id}`);
    expect((done.body as { status: string }).status).toBe("REJECTED");
  });

  it("blocks sending a lone or unpriced option set", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const ch = await estimatingChange(fx.owner.agent, fx.projectId, "Half optional");
    await fx.owner.agent.post(`/api/v1/change-requests/${ch.id}/options`).send(option("Only", 50000));
    const send = await fx.owner.agent.post(`/api/v1/change-requests/${ch.id}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(),
    });
    expect(send.status).toBe(422);
    const detail = await fx.owner.agent.get(`/api/v1/change-requests/${ch.id}`);
    expect(((detail.body as { sendBlockers: string[] }).sendBlockers.join(" "))).toMatch(/2–4|2-4/);
  });

  it("requires every approver to pick the same option", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const ch = await estimatingChange(fx.owner.agent, fx.projectId, "Agree to agree");
    const full = await fx.owner.agent.post(`/api/v1/change-requests/${ch.id}/options`).send(option("Full", 200000));
    const reduced = await fx.owner.agent.post(`/api/v1/change-requests/${ch.id}/options`).send(option("Reduced", 80000));
    const send = await fx.owner.agent.post(`/api/v1/change-requests/${ch.id}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      approverEmails: ["dana@client.test"],
      policyMode: "ALL",
      expiresAt: EXPIRY(),
    });
    expect(send.status).toBe(201);
    const [first, second] = tokensOf(send.body);

    const vote1 = await request(app).post(`/api/v1/approval-requests/${first}/decisions`).send({
      decision: "APPROVED",
      optionId: full.body.id as string,
      confirm: true,
    });
    expect(vote1.status).toBe(201);
    expect(vote1.body.outcome.state).toBe("PENDING");

    const split = await request(app).post(`/api/v1/approval-requests/${second}/decisions`).send({
      decision: "APPROVED",
      optionId: reduced.body.id as string,
      confirm: true,
    });
    expect(split.status).toBe(409);

    const vote2 = await request(app).post(`/api/v1/approval-requests/${second}/decisions`).send({
      decision: "APPROVED",
      optionId: full.body.id as string,
      confirm: true,
    });
    expect(vote2.status).toBe(201);
    expect(vote2.body.outcome.state).toBe("APPROVED");
  });

  it("invalidates the live package when options change mid-review", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const ch = await estimatingChange(fx.owner.agent, fx.projectId, "Moving target");
    await fx.owner.agent.post(`/api/v1/change-requests/${ch.id}/options`).send(option("Full", 200000));
    await fx.owner.agent.post(`/api/v1/change-requests/${ch.id}/options`).send(option("Reduced", 80000));
    const send = await fx.owner.agent.post(`/api/v1/change-requests/${ch.id}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(),
    });
    expect(send.status).toBe(201);
    const [token] = tokensOf(send.body);

    const late = await fx.owner.agent.post(`/api/v1/change-requests/${ch.id}/options`).send(option("Defer", 0));
    expect(late.status).toBe(201);

    const after = await fx.owner.agent.get(`/api/v1/change-requests/${ch.id}`);
    expect((after.body as { status: string }).status).toBe("ESTIMATING");
    expect(((after.body as { approvals: Array<{ status: string }> }).approvals[0] as { status: string }).status).toBe("INVALIDATED");
    const decide = await request(app).post(`/api/v1/approval-requests/${token}/decisions`).send({
      decision: "APPROVED",
      confirm: true,
    });
    expect(decide.status).toBe(409);
  });

  it("audits option lifecycle events", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    const ch = await estimatingChange(fx.owner.agent, fx.projectId, "Audited options");
    const created = await fx.owner.agent.post(`/api/v1/change-requests/${ch.id}/options`).send(option("Full", 200000));
    await fx.owner.agent.patch(`/api/v1/change-requests/${ch.id}/options/${created.body.id as string}`).send({
      expectedVersion: 0,
      notes: "Priced with the team",
    });
    await fx.owner.agent.delete(`/api/v1/change-requests/${ch.id}/options/${created.body.id as string}`);
    const events = (await store.listAuditEvents({ projectId: fx.projectId, limit: 100 })).items;
    const actions = events.map((e) => e.action);
    expect(actions).toContain("change.option_added");
    expect(actions).toContain("change.option_updated");
    expect(actions).toContain("change.option_removed");
  });
});

describe("parked changes", () => {
  it("parks pre-decision work, hides it from sending, and revives it", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const ch = await estimatingChange(fx.owner.agent, fx.projectId, "Shelve me");

    const park = await fx.owner.agent.patch(`/api/v1/change-requests/${ch.id}`).send({
      expectedVersion: ch.version,
      status: "PARKED",
    });
    expect(park.status).toBe(200);

    // Parked work cannot send: revive first.
    const send = await fx.owner.agent.post(`/api/v1/change-requests/${ch.id}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(),
    });
    expect(send.status).toBe(422);

    // The parked view lists it.
    const parked = await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/change-requests?status=PARKED&limit=50`);
    expect(parked.status).toBe(200);
    expect(((parked.body as { data: Array<{ id: string }> }).data.map((c) => c.id))).toContain(ch.id);

    // Revival is a new submission.
    const revive = await fx.owner.agent.patch(`/api/v1/change-requests/${ch.id}`).send({
      expectedVersion: (park.body as { version: number }).version,
      status: "SUBMITTED",
    });
    expect(revive.status).toBe(200);
    expect(revive.body.status).toBe("SUBMITTED");
  });

  it("refuses to park live or decided work, and refuses client parking", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const ch = await estimatingChange(fx.owner.agent, fx.projectId, "Live wire");
    await fx.owner.agent.post(`/api/v1/change-requests/${ch.id}/impact`).send({
      effortDays: 1,
      priceMinor: 5000,
      confidence: "LOW",
    });
    const send = await fx.owner.agent.post(`/api/v1/change-requests/${ch.id}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: EXPIRY(),
    });
    expect(send.status).toBe(201);
    const live = await fx.owner.agent.get(`/api/v1/change-requests/${ch.id}`);

    const parkLive = await fx.owner.agent.patch(`/api/v1/change-requests/${ch.id}`).send({
      expectedVersion: (live.body as { version: number }).version,
      status: "PARKED",
    });
    expect(parkLive.status).toBe(409);

    // Clients cannot park (triage permission).
    const ch2 = await estimatingChange(fx.owner.agent, fx.projectId, "Client shelve");
    const rogue = await fx.client.agent.patch(`/api/v1/change-requests/${ch2.id}`).send({
      expectedVersion: ch2.version,
      status: "PARKED",
    });
    expect(rogue.status).toBe(403);
  });
});

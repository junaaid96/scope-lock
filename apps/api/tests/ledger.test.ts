import { beforeEach, describe, expect, it } from "vitest";
import { ContractLedgerSchema, ErrorEnvelopeSchema, OrgContractRollupSchema } from "@scopelock/contracts";
import { computeContractLedger } from "@scopelock/domain";
import { agencyFixture, createTestApp, draftScope, register, type Agent, type TestApp } from "./helpers.js";

let t: TestApp;

beforeEach(() => {
  t = createTestApp();
});

async function budgetedProject(agent: Agent, args: { organizationId: string; clientId: string; name: string; currency: string; budgetMinor?: number }): Promise<string> {
  const res = await agent.post("/api/v1/projects").send({
    organizationId: args.organizationId,
    clientId: args.clientId,
    name: args.name,
    currency: args.currency,
    ...(args.budgetMinor !== undefined ? { budgetMinor: args.budgetMinor } : {}),
  });
  if (res.status !== 201) throw new Error(`budgetedProject failed: ${JSON.stringify(res.body)}`);
  return (res.body as { id: string }).id;
}

async function driveChange(
  agent: Agent,
  projectId: string,
  input: { title: string; priceMinor: number; currency: string; effortDays: number },
): Promise<{ changeId: string; number: string }> {
  const created = await agent.post(`/api/v1/projects/${projectId}/change-requests`).send({
    title: input.title,
    description: `${input.title} description`,
    source: "AGENCY",
  });
  if (created.status !== 201) throw new Error(`create change failed: ${JSON.stringify(created.body)}`);
  let version = (created.body as { version: number }).version;
  const changeId = (created.body as { id: string }).id;
  for (const status of ["SUBMITTED", "TRIAGING", "ESTIMATING"]) {
    const patched = await agent.patch(`/api/v1/change-requests/${changeId}`).send({ expectedVersion: version, status });
    if (patched.status !== 200) throw new Error(`transition to ${status} failed: ${JSON.stringify(patched.body)}`);
    version = (patched.body as { version: number }).version;
  }
  const impact = await agent.post(`/api/v1/change-requests/${changeId}/impact`).send({
    effortDays: input.effortDays,
    priceMinor: input.priceMinor,
    currency: input.currency,
    confidence: "HIGH",
  });
  if (impact.status !== 201 && impact.status !== 200) throw new Error(`impact failed: ${JSON.stringify(impact.body)}`);
  return { changeId, number: (created.body as { number: string }).number };
}

describe("contract value ledger", () => {
  it("derives baseline + deltas + exposure + absorbed from raw records", async () => {
    const { app } = t;
    const fx = await agencyFixture(app);
    const projectId = await budgetedProject(fx.owner.agent, {
      organizationId: fx.organizationId,
      clientId: fx.clientId,
      name: "Ledger",
      currency: "USD",
      budgetMinor: 100000,
    });
    const { draftId, version } = await draftScope(fx.owner.agent, projectId);
    const published = await fx.owner.agent.post(`/api/v1/scope-versions/${draftId}/publish`).send({ expectedVersion: version });
    expect(published.status).toBe(200);

    async function sendAndMaybeDecide(changeId: string, decision: "APPROVED" | null): Promise<void> {
      const send = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
        approverUserIds: [fx.owner.user.id],
        expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      });
      expect(send.status).toBe(201);
      if (decision) {
        const approvalId = ((send.body as { approval: { id: string } }).approval).id;
        const decide = await fx.owner.agent.post(`/api/v1/approval-requests/${approvalId}/decisions`).send({
          decision,
          confirm: true,
        });
        expect(decide.status).toBe(201);
      }
    }

    const priced = await driveChange(fx.owner.agent, projectId, { title: "Priced", priceMinor: 25000, currency: "USD", effortDays: 3 });
    await sendAndMaybeDecide(priced.changeId, "APPROVED");
    const convert = await fx.owner.agent.post(`/api/v1/change-requests/${priced.changeId}/convert-to-scope`).send({});
    expect(convert.status).toBe(201);
    const amendmentId = (convert.body as { id: string }).id;
    const publishAmend = await fx.owner.agent.post(`/api/v1/scope-versions/${amendmentId}/publish`).send({ expectedVersion: 0 });
    expect(publishAmend.status).toBe(200);

    const free = await driveChange(fx.owner.agent, projectId, { title: "Freebie", priceMinor: 0, currency: "USD", effortDays: 5 });
    await sendAndMaybeDecide(free.changeId, "APPROVED");
    const unlinked = await driveChange(fx.owner.agent, projectId, { title: "Unlinked", priceMinor: 3000, currency: "USD", effortDays: 1 });
    await sendAndMaybeDecide(unlinked.changeId, "APPROVED");
    const waiting = await driveChange(fx.owner.agent, projectId, { title: "Waiting", priceMinor: 40000, currency: "USD", effortDays: 4 });
    await sendAndMaybeDecide(waiting.changeId, null);

    const res = await fx.owner.agent.get(`/api/v1/projects/${projectId}/contract`);
    expect(res.status).toBe(200);
    expect(() => ContractLedgerSchema.parse(res.body)).not.toThrow();
    const ledger = res.body as {
      currency: string; baselineMinor: number; approvedDeltaMinor: number; currentMinor: number;
      pendingExposureMinor: number; unattributedMinor: number; absorbedEffortDays: number; absorbedCount: number;
      deltas: Array<{ number: string }>; pending: Array<{ number: string }>;
      absorbed: Array<{ number: string }>; excluded: Array<{ number: string; reason: string }>;
      byVersion: Array<{ sequence: number; deltaMinor: number; changeNumbers: string[] }>;
    };
    expect(ledger.currency).toBe("USD");
    expect(ledger.baselineMinor).toBe(100000);
    expect(ledger.approvedDeltaMinor).toBe(28000);
    expect(ledger.currentMinor).toBe(128000);
    expect(ledger.pendingExposureMinor).toBe(40000);
    expect(ledger.deltas.map((d) => d.number).sort()).toEqual([priced.number, unlinked.number].sort());
    expect(ledger.pending.map((p) => p.number)).toEqual([waiting.number]);
    expect(ledger.absorbed.map((a) => a.number)).toEqual([free.number]);
    expect(ledger.absorbedEffortDays).toBe(5);
    expect(ledger.absorbedCount).toBe(1);
    expect(ledger.excluded).toEqual([]);
    expect(ledger.unattributedMinor).toBe(3000);
    expect(ledger.byVersion.map((v) => [v.sequence, v.deltaMinor])).toEqual([[1, 0], [2, 25000]]);

    // Reconciliation: the endpoint must equal a recomputation from raw records.
    const changes = await fx.owner.agent.get(`/api/v1/projects/${projectId}/change-requests?limit=100`);
    const versions = await fx.owner.agent.get(`/api/v1/projects/${projectId}/scope-versions?limit=100`);
    const recomputed = computeContractLedger({
      currency: "USD",
      baselineMinor: 100000,
      changes: ((changes.body as { data: Array<{ id: string; number: string; title: string; status: string; decidedAt: string | null; amendmentVersionId: string | null; impact: { priceMinor: number | null; currency: string | null; effortDays: number | null } | null }> }).data)
        .filter((c) => ["APPROVED", "IMPLEMENTED", "PENDING_APPROVAL"].includes(c.status))
        .map((c) => ({
          changeId: c.id,
          number: c.number,
          title: c.title,
          status: c.status,
          priceMinor: c.impact?.priceMinor ?? null,
          currency: c.impact?.currency ?? null,
          effortDays: c.impact?.effortDays ?? null,
          decidedAt: c.decidedAt,
          amendmentVersionId: c.amendmentVersionId,
        })),
      versions: ((versions.body as { data: Array<{ id: string; sequence: number; status: string; title: string | null }> }).data).map((v) => ({
        scopeVersionId: v.id,
        sequence: v.sequence,
        status: v.status,
        title: v.title,
      })),
    });
    expect(res.body).toEqual(JSON.parse(JSON.stringify(recomputed)));
  });

  it("excludes approved deltas stranded by a project currency change", async () => {
    const { app } = t;
    const fx = await agencyFixture(app);
    const projectId = await budgetedProject(fx.owner.agent, {
      organizationId: fx.organizationId,
      clientId: fx.clientId,
      name: "Switched",
      currency: "USD",
      budgetMinor: 100000,
    });
    const priced = await driveChange(fx.owner.agent, projectId, { title: "Priced", priceMinor: 25000, currency: "USD", effortDays: 3 });
    const send = await fx.owner.agent.post(`/api/v1/change-requests/${priced.changeId}/approval-requests`).send({
      approverUserIds: [fx.owner.user.id],
      expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    });
    expect(send.status).toBe(201);
    const approvalId = ((send.body as { approval: { id: string } }).approval).id;
    const decide = await fx.owner.agent.post(`/api/v1/approval-requests/${approvalId}/decisions`).send({ decision: "APPROVED", confirm: true });
    expect(decide.status).toBe(201);
    const switched = await fx.owner.agent.patch(`/api/v1/projects/${projectId}`).send({ currency: "EUR" });
    expect(switched.status).toBe(200);
    const res = await fx.owner.agent.get(`/api/v1/projects/${projectId}/contract`);
    expect(res.status).toBe(200);
    const ledger = res.body as { currency: string; approvedDeltaMinor: number; excluded: Array<{ number: string; reason: string }> };
    expect(ledger.currency).toBe("EUR");
    expect(ledger.approvedDeltaMinor).toBe(0);
    expect(ledger.excluded).toEqual([{ changeId: expect.any(String), number: priced.number, reason: "CURRENCY_MISMATCH", detail: expect.any(String) }]);
  });

  it("scopes the org rollup to visible projects and groups by currency", async () => {
    const { app } = t;
    const fx = await agencyFixture(app);
    const usd = await budgetedProject(fx.owner.agent, { organizationId: fx.organizationId, clientId: fx.clientId, name: "USD project", currency: "USD", budgetMinor: 100000 });
    const eur = await budgetedProject(fx.owner.agent, { organizationId: fx.organizationId, clientId: fx.clientId, name: "EUR project", currency: "EUR" });
    // Owner (operator) sees every project, including the zero-baseline EUR one.
    const rollup = await fx.owner.agent.get(`/api/v1/organizations/${fx.organizationId}/contract`);
    expect(rollup.status).toBe(200);
    expect(() => OrgContractRollupSchema.parse(rollup.body)).not.toThrow();
    const body = rollup.body as { projects: Array<{ projectId: string }>; totalsByCurrency: Array<{ currency: string; projectCount: number }> };
    expect(body.projects.map((p) => p.projectId).sort()).toEqual([fx.projectId, usd, eur].sort());
    expect(body.totalsByCurrency).toEqual([
      { currency: "EUR", projectCount: 1, baselineMinor: 0, currentMinor: 0, pendingExposureMinor: 0 },
      { currency: "USD", projectCount: 2, baselineMinor: 100000, currentMinor: 100000, pendingExposureMinor: 0 },
    ]);
    // The client member sees only their assigned project.
    const scoped = await fx.client.agent.get(`/api/v1/organizations/${fx.organizationId}/contract`);
    expect(scoped.status).toBe(200);
    expect((scoped.body as { projects: Array<{ projectId: string }> }).projects.map((p) => p.projectId)).toEqual([fx.projectId]);
  });

  it("enforces project visibility: viewer reads, outsiders get 404 envelopes", async () => {
    const { app } = t;
    const fx = await agencyFixture(app);
    const viewer = await register(app, { email: "viewer@agency.test", organizationName: "Temp" });
    const invite = await fx.owner.agent.post(`/api/v1/organizations/${fx.organizationId}/invitations`).send({ email: viewer.user.email, role: "CLIENT" });
    await viewer.agent.post(`/api/v1/auth/invitations/${(invite.body as { token: string }).token}/accept`).send({});
    const added = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/members`).send({ userId: viewer.user.id, role: "CLIENT_VIEWER" });
    expect(added.status).toBe(201);
    const seen = await viewer.agent.get(`/api/v1/projects/${fx.projectId}/contract`);
    expect(seen.status).toBe(200);

    // Org member with no project role sees nothing.
    const member = await register(app, { email: "member@agency.test", organizationName: "Temp" });
    const inviteMember = await fx.owner.agent.post(`/api/v1/organizations/${fx.organizationId}/invitations`).send({ email: member.user.email, role: "MEMBER" });
    await member.agent.post(`/api/v1/auth/invitations/${(inviteMember.body as { token: string }).token}/accept`).send({});
    const hidden = await member.agent.get(`/api/v1/projects/${fx.projectId}/contract`);
    expect(hidden.status).toBe(404);
    expect(() => ErrorEnvelopeSchema.parse(hidden.body)).not.toThrow();

    // Cross-org IDOR probe.
    const outsider = await register(app, { email: "outsider@evil.test", organizationName: "Evil" });
    const probed = await outsider.agent.get(`/api/v1/projects/${fx.projectId}/contract`);
    expect(probed.status).toBe(404);
    expect(() => ErrorEnvelopeSchema.parse(probed.body)).not.toThrow();
    const rolled = await outsider.agent.get(`/api/v1/organizations/${fx.organizationId}/contract`);
    expect(rolled.status).toBe(404);
  });
});

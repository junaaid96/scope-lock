import { describe, expect, it } from "vitest";
import request from "supertest";
import { AuditVerifyResponseSchema } from "@scopelock/contracts";
import { GENESIS_PREV_HASH, verifyAuditChain } from "@scopelock/domain";
import type { AuditEvent } from "../src/store/index.js";
import { agencyFixture, createTestApp, register, type Agent } from "./helpers.js";

async function seedActivity(agent: Agent, projectId: string): Promise<string> {
  const created = await agent.post(`/api/v1/projects/${projectId}/change-requests`).send({
    title: "Chained work",
    description: "Chained work description",
    source: "AGENCY",
  });
  expect(created.status).toBe(201);
  const id = created.body.id as string;
  const res = await agent.patch(`/api/v1/change-requests/${id}`).send({
    expectedVersion: created.body.version as number,
    status: "SUBMITTED",
  });
  expect(res.status).toBe(200);
  return id;
}

describe("audit hash chain", () => {
  it("chains every project event and verifies valid", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    await seedActivity(fx.owner.agent, fx.projectId);

    const res = await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/audit/verify`);
    expect(res.status).toBe(200);
    const body = AuditVerifyResponseSchema.parse(res.body);
    expect(body.chainKey).toBe(`project:${fx.projectId}`);
    expect(body.valid).toBe(true);
    expect(body.chained).toBeGreaterThan(0);
    expect(body.chained).toBe(body.events);
    expect(body.legacy).toBe(0);
    expect(body.headHash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.headSeq).toBe(body.chained);

    // Independent recomputation from raw store rows agrees.
    const events = await store.listAuditChain(`project:${fx.projectId}`);
    expect(events[0]?.prevHash).toBe(GENESIS_PREV_HASH);
    expect(events[0]?.chainSeq).toBe(1);
    expect(verifyAuditChain(events).valid).toBe(true);
    // Chain linkage is contiguous: every link binds its predecessor.
    for (let i = 1; i < events.length; i++) {
      expect(events[i]?.prevHash).toBe(events[i - 1]?.hash);
      expect(events[i]?.chainSeq).toBe((events[i - 1]?.chainSeq ?? 0) + 1);
    }
  });

  it("lets project clients verify but blocks outsiders and anonymous callers", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    await seedActivity(fx.owner.agent, fx.projectId);

    const client = await fx.client.agent.get(`/api/v1/projects/${fx.projectId}/audit/verify`);
    expect(client.status).toBe(200);
    expect((client.body as { valid: boolean }).valid).toBe(true);

    const anon = await request(app).get(`/api/v1/projects/${fx.projectId}/audit/verify`);
    expect(anon.status).toBe(401);

    const outsider = await register(app, { email: "outsider@evil.test", organizationName: "Evil" });
    const idor = await outsider.agent.get(`/api/v1/projects/${fx.projectId}/audit/verify`);
    expect(idor.status).toBe(404);

    const missing = await fx.owner.agent.get("/api/v1/projects/prj_doesnotexist/audit/verify");
    expect(missing.status).toBe(404);
  });

  it("detects tampered history and reports the break", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    await seedActivity(fx.owner.agent, fx.projectId);

    // White-box tamper: edit one stored event behind the API's back.
    const exposed = store as unknown as { tables: { auditEvents: Map<string, AuditEvent> } };
    const events = await store.listAuditChain(`project:${fx.projectId}`);
    const victim = events.find((e) => e.chainSeq === 2) ?? events[0];
    if (!victim) throw new Error("expected seeded chain events");
    exposed.tables.auditEvents.set(victim.id, { ...victim, action: "change.approved" });

    const res = await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/audit/verify`);
    expect(res.status).toBe(200);
    const body = AuditVerifyResponseSchema.parse(res.body);
    expect(body.valid).toBe(false);
    expect(body.breakAtSeq).toBe(victim.chainSeq);
    expect(body.reason).toMatch(/hash mismatch/);
  });

  it("serializes concurrent appends into one fork-free chain", async () => {
    const { store } = createTestApp();
    const orgId = "org_chain";
    const projectId = "prj_chain";
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        store.appendAuditEvent({
          organizationId: orgId,
          projectId,
          actorId: null,
          actorEmail: null,
          action: `test.write.${i}`,
          targetType: "PROJECT",
          targetId: projectId,
          correlationId: `corr-${i}`,
          ip: null,
        }),
      ),
    );
    const events = await store.listAuditChain(`project:${projectId}`);
    expect(events).toHaveLength(20);
    expect(events.map((e) => e.chainSeq).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(verifyAuditChain(events)).toMatchObject({ valid: true, checked: 20 });
    const head = await store.getAuditChainHead(`project:${projectId}`);
    expect(head?.eventCount).toBe(20);
    expect(head?.headHash).toBe(events.find((e) => e.chainSeq === 20)?.hash);
  });

  it("chains org-level events under the org key", async () => {
    const { store } = createTestApp();
    await store.appendAuditEvent({
      organizationId: "org_solo",
      projectId: null,
      actorId: null,
      actorEmail: null,
      action: "org.created",
      targetType: "ORG",
      targetId: "org_solo",
      correlationId: "corr-org",
      ip: null,
    });
    const events = await store.listAuditChain("org:org_solo");
    expect(events).toHaveLength(1);
    expect(events[0]?.prevHash).toBe(GENESIS_PREV_HASH);
    expect(verifyAuditChain(events).valid).toBe(true);
  });
});

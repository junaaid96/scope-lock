import { describe, expect, it } from "vitest";
import request from "supertest";
import { MemorySearchQuerySchema } from "@scopelock/contracts";
import { agencyFixture, createProject, createTestApp, register, type Agent } from "./helpers.js";

async function decidedChange(agent: Agent, projectId: string, title: string): Promise<string> {
  const created = await agent.post(`/api/v1/projects/${projectId}/change-requests`).send({
    title,
    description: `${title} description needs decision`,
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

describe("decision memory search", () => {
  it("returns decided changes with verbatim excerpts before any other status", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const decidedId = await decidedChange(fx.owner.agent, fx.projectId, "Recallable dark-mode toggle");
    const sent = await fx.owner.agent.post(`/api/v1/change-requests/${decidedId}/approval-requests`).send({
      approverUserIds: [fx.clientUserId],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(sent.status).toBe(201);
    const token = ((sent.body as { reviewUrls: string[] }).reviewUrls[0] as string).split("/review/")[1] as string;
    const decision = await request(app)
      .post(`/api/v1/approval-requests/${token}/decisions`)
      .send({ decision: "APPROVED", confirm: true });
    expect(decision.status).toBe(201);

    const res = await fx.owner.agent
      .get(`/api/v1/organizations/${fx.organizationId}/memory/search`)
      .query({ q: "Recallable" });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("lexical");
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].changeId).toBe(decidedId);
    expect(res.body.data[0].outcome).toBe("APPROVED");
    expect(res.body.data[0].excerpt).toContain("Recallable dark-mode toggle description");
  });

  it("filters by requester access before ranking and rejects cross-org reads", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    await decidedChange(fx.owner.agent, fx.projectId, "Hidden access-gated change");

    // A viewer in the same org but without membership in that project sees nothing.
    const other = await createProject(app, fx.owner.agent, {
      organizationId: fx.organizationId,
      clientId: fx.clientId,
      name: "Other project",
    });
    const limited = await register(app, { email: "viewer.memory@example.com", organizationName: "Temp two" });
    const invite = await fx.owner.agent.post(`/api/v1/organizations/${fx.organizationId}/invitations`).send({
      email: "viewer.memory@example.com",
      role: "MEMBER",
    });
    expect(invite.status).toBe(201);
    const accept = await limited.agent
      .post(`/api/v1/auth/invitations/${(invite.body as { token: string }).token}/accept`)
      .send({});
    expect(accept.status).toBe(200);
    const member = await fx.owner.agent.post(`/api/v1/projects/${other.id}/members`).send({
      userId: limited.user.id,
      role: "MEMBER",
    });
    expect(member.status).toBe(201);
    const gated = await limited.agent
      .get(`/api/v1/organizations/${fx.organizationId}/memory/search`)
      .query({ q: "Hidden" });
    expect(gated.status).toBe(200);
    expect(gated.body.data).toHaveLength(0);

    // Unknown org is rejected (IDOR guard).
    const cross = await fx.owner.agent
      .get("/api/v1/organizations/org_doesnotexist/memory/search")
      .query({ q: "Hidden" });
    expect([403, 404]).toContain(cross.status);
  });

  it("validates the query contract and semantic fallback mode", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const empty = await fx.owner.agent
      .get(`/api/v1/organizations/${fx.organizationId}/memory/search`)
      .query({ q: "x" });
    expect(empty.status).toBe(400);
    const semantic = await fx.owner.agent
      .get(`/api/v1/organizations/${fx.organizationId}/memory/search`)
      .query({ q: "anything here" });
    expect(semantic.status).toBe(200);
    expect(semantic.body.mode).toBe("lexical");
    expect(MemorySearchQuerySchema.safeParse({ q: "x" }).success).toBe(false);
    expect(MemorySearchQuerySchema.safeParse({ q: "anything here" }).success).toBe(true);
  });
});

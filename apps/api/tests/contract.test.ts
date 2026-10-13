import { describe, expect, it } from "vitest";
import { z } from "zod";
import request from "supertest";
import { ErrorEnvelopeSchema, listEnvelope } from "@scopelock/contracts";
import { agencyFixture, createTestApp } from "./helpers.js";

const AnyList = listEnvelope(z.unknown());

describe("API contracts", () => {
  it("returns the standard error envelope for 4xx failures", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const notFound = await fx.owner.agent.get("/api/v1/change-requests/chg_doesnotexist");
    expect(notFound.status).toBe(404);
    expect(() => ErrorEnvelopeSchema.parse(notFound.body)).not.toThrow();

    const validation = await request(app).post("/api/v1/auth/login").send({ email: "bad" });
    expect(validation.status).toBe(400);
    const parsed = ErrorEnvelopeSchema.parse(validation.body);
    expect(parsed.error.code).toBe("VALIDATION_ERROR");
    expect(parsed.error.details).toBeTruthy();

    const forbidden = await fx.client.agent.get(`/api/v1/organizations/${fx.organizationId}/members`);
    expect(forbidden.status).toBe(403);
    expect(() => ErrorEnvelopeSchema.parse(forbidden.body)).not.toThrow();
  });

  it("returns the standard list envelope with cursor pagination", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    for (const title of ["One", "Two", "Three"]) {
      await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/change-requests`).send({
        title, description: `${title} desc`, source: "AGENCY",
      });
    }
    const page1 = await fx.owner.agent.get(`/api/v1/projects/${fx.projectId}/change-requests?limit=2`);
    expect(page1.status).toBe(200);
    expect(() => AnyList.parse(page1.body)).not.toThrow();
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.pagination.nextCursor).toBeTruthy();
    expect(page1.body.pagination.nextCursor).not.toContain("CHG-");

    const page2 = await fx.owner.agent.get(
      `/api/v1/projects/${fx.projectId}/change-requests?limit=2&cursor=${encodeURIComponent(page1.body.pagination.nextCursor as string)}`,
    );
    expect(page2.body.data).toHaveLength(1);
    expect(page2.body.pagination.nextCursor).toBeNull();

    for (const path of [
      `/api/v1/projects?organizationId=${fx.organizationId}`,
      `/api/v1/projects/${fx.projectId}/activity`,
      "/api/v1/notifications",
      "/api/v1/inbox",
    ]) {
      const res = await fx.owner.agent.get(path);
      expect(res.status, path).toBe(200);
      expect(() => AnyList.parse(res.body), path).not.toThrow();
    }
  });

  it("echoes request ids and serves JSON content types", async () => {
    const { app } = createTestApp();
    const res = await request(app).get("/api/v1/nope").set("X-Request-Id", "contract-1");
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.headers["x-request-id"]).toBe("contract-1");
    const ok = await request(app).get("/healthz");
    expect(ok.headers["content-type"]).toMatch(/application\/json/);
    expect(ok.body.ok).toBe(true);
  });
});

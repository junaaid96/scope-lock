import { describe, expect, it } from "vitest";
import { agencyFixture, createTestApp } from "./helpers.js";
import { resolveLocale } from "../src/modules/approvals.js";

describe("locale plumbing", () => {
  it("stores per-user locale via preferences and exposes it on the session", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);

    const prefs = await fx.owner.agent.get("/api/v1/auth/me/preferences");
    expect(prefs.status).toBe(200);
    expect(prefs.body.locale).toBe("en");

    const updated = await fx.owner.agent.patch("/api/v1/auth/me/preferences").send({ locale: "bn" });
    expect(updated.status).toBe(200);
    expect(updated.body.locale).toBe("bn");

    const me = await fx.owner.agent.get("/api/v1/auth/me");
    expect(me.body.user.locale).toBe("bn");

    const bad = await fx.owner.agent.patch("/api/v1/auth/me/preferences").send({ locale: "fr" });
    expect(bad.status).toBe(400);
  });

  it("stores org and project review-link defaults", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);

    const org = await fx.owner.agent.patch(`/api/v1/organizations/${fx.organizationId}`).send({ defaultLocale: "bn" });
    expect(org.status).toBe(200);
    expect(org.body.settings.defaultLocale).toBe("bn");

    const project = await fx.owner.agent.patch(`/api/v1/projects/${fx.projectId}`).send({
      settings: { defaultLocale: "en" },
    });
    expect(project.status).toBe(200);
    expect(project.body.settings.defaultLocale).toBe("en");

    // Explicit null reverts the project to org-inherit.
    const cleared = await fx.owner.agent.patch(`/api/v1/projects/${fx.projectId}`).send({
      settings: { defaultLocale: null },
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.settings.defaultLocale).toBeNull();

    // Clients cannot change org locale.
    const denied = await fx.client.agent.patch(`/api/v1/organizations/${fx.organizationId}`).send({ defaultLocale: "en" });
    expect(denied.status).toBe(403);
  });

  it("serves the org default locale on review and verify payloads", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const org = await fx.owner.agent.patch(`/api/v1/organizations/${fx.organizationId}`).send({ defaultLocale: "bn" });
    expect(org.status).toBe(200);

    const created = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/change-requests`).send({
      title: "Localised launch",
      description: "Localised launch description",
      source: "AGENCY",
    });
    expect(created.status).toBe(201);
    const changeId = created.body.id as string;
    let v = created.body.version as number;
    for (const status of ["SUBMITTED", "TRIAGING", "ESTIMATING"]) {
      const res = await fx.owner.agent.patch(`/api/v1/change-requests/${changeId}`).send({
        expectedVersion: v,
        status,
        ...(status === "TRIAGING" ? { classification: "POTENTIAL_CHANGE", classificationRationale: "New work" } : {}),
      });
      expect(res.status).toBe(200);
      v = res.body.version as number;
    }
    const impact = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/impact`).send({
      effortDays: 2,
      priceMinor: 50000,
      timelineDays: 3,
      confidence: "HIGH",
    });
    expect(impact.status).toBe(201);
    const me = await fx.owner.agent.get("/api/v1/auth/me");
    const send = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/approval-requests`).send({
      approverUserIds: [(me.body.user as { id: string }).id],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(send.status).toBe(201);
    const approvalId = (send.body.approval as { id: string }).id;

    const ref = ((send.body.reviewUrls as string[])[0] as string).split("/").pop() as string;
    const review = await fx.owner.agent.get(`/api/v1/approval-requests/${ref}`);
    expect(review.status).toBe(200);
    expect(review.body.locale).toBe("bn");

    const verify = await fx.owner.agent.get(`/api/v1/verify/${approvalId}`);
    expect(verify.status).toBe(200);
    expect(verify.body.locale).toBe("bn");
    expect(verify.body.organization).toBeUndefined();
  });

  it("resolves review locale as project override, org default, then English", () => {
    expect(resolveLocale({ settings: { defaultLocale: "bn" } }, { settings: { defaultLocale: null } })).toBe("bn");
    expect(resolveLocale({ settings: { defaultLocale: "bn" } }, { settings: { defaultLocale: "en" } })).toBe("en");
    expect(resolveLocale({ settings: {} }, { settings: {} })).toBe("en");
    expect(resolveLocale(null, { settings: {} })).toBe("en");
    expect(resolveLocale({ settings: { defaultLocale: "xx" } }, { settings: {} })).toBe("en");
  });
});

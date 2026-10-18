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

  it("resolves review locale as project override, org default, then English", () => {
    expect(resolveLocale({ settings: { defaultLocale: "bn" } }, { settings: { defaultLocale: null } })).toBe("bn");
    expect(resolveLocale({ settings: { defaultLocale: "bn" } }, { settings: { defaultLocale: "en" } })).toBe("en");
    expect(resolveLocale({ settings: {} }, { settings: {} })).toBe("en");
    expect(resolveLocale(null, { settings: {} })).toBe("en");
    expect(resolveLocale({ settings: { defaultLocale: "xx" } }, { settings: {} })).toBe("en");
  });
});

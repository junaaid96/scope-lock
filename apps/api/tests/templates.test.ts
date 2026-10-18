import { describe, expect, it } from "vitest";
import { CsvImportResponseSchema } from "@scopelock/contracts";
import { agencyFixture, createTestApp, draftScope } from "./helpers.js";

const TEMPLATE = {
  name: "Website starter",
  projectType: "Website",
  description: "Standard marketing site",
  assumptions: ["Client provides copy", "English only"],
  exclusions: ["Native mobile apps"],
  items: [
    {
      title: "Homepage",
      description: "Marketing landing page",
      acceptanceCriteria: ["Loads in under 2s", "Contact form works"],
      category: "Pages",
      priority: "HIGH",
    },
    {
      title: "Blog",
      description: "Article listing and posts",
      acceptanceCriteria: [],
    },
  ],
};

describe("scope templates", () => {
  it("manages org templates with staff-only write access", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);

    const created = await fx.owner.agent.post(`/api/v1/organizations/${fx.organizationId}/scope-templates`).send(TEMPLATE);
    expect(created.status).toBe(201);
    expect(created.body.items).toHaveLength(2);

    // Client org role cannot manage (or view) agency templates.
    const denied = await fx.client.agent.post(`/api/v1/organizations/${fx.organizationId}/scope-templates`).send(TEMPLATE);
    expect(denied.status).toBe(403);
    const hidden = await fx.client.agent.get(`/api/v1/organizations/${fx.organizationId}/scope-templates`);
    expect(hidden.status).toBe(403);

    const listed = await fx.owner.agent.get(`/api/v1/organizations/${fx.organizationId}/scope-templates`);
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);
    const filtered = await fx.owner.agent
      .get(`/api/v1/organizations/${fx.organizationId}/scope-templates`)
      .query({ projectType: "website" });
    expect(filtered.body.data).toHaveLength(1);
    const missed = await fx.owner.agent
      .get(`/api/v1/organizations/${fx.organizationId}/scope-templates`)
      .query({ projectType: "Mobile" });
    expect(missed.body.data).toHaveLength(0);

    const renamed = await fx.owner.agent
      .patch(`/api/v1/organizations/${fx.organizationId}/scope-templates/${created.body.id as string}`)
      .send({ name: "Website starter v2" });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe("Website starter v2");

    // Cross-org template ids do not resolve.
    const cross = await fx.owner.agent
      .patch(`/api/v1/organizations/${fx.organizationId}/scope-templates/st_nope`)
      .send({ name: "x" });
    expect(cross.status).toBe(404);

    const removed = await fx.owner.agent.delete(
      `/api/v1/organizations/${fx.organizationId}/scope-templates/${created.body.id as string}`,
    );
    expect(removed.status).toBe(204);
    const events = await store.listAuditEvents({ organizationId: fx.organizationId, limit: 50 });
    expect(events.items.map((e) => e.action)).toEqual(
      expect.arrayContaining(["template.created", "template.updated", "template.deleted"]),
    );
  });

  it("instantiates a template into a draft with requirements", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    const created = await fx.owner.agent.post(`/api/v1/organizations/${fx.organizationId}/scope-templates`).send(TEMPLATE);
    expect(created.status).toBe(201);

    const inst = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/scope-versions/draft/from-template`).send({
      templateId: created.body.id as string,
      name: "Templated scope",
    });
    expect(inst.status).toBe(201);
    expect(inst.body.draft.assumptions).toEqual(["Client provides copy", "English only"]);
    expect(inst.body.draft.exclusions).toEqual(["Native mobile apps"]);
    expect(inst.body.draft.title).toBe("Website starter");
    expect(inst.body.stableKeys).toHaveLength(2);

    const reqs = await store.listRequirements(fx.projectId);
    expect(reqs).toHaveLength(2);
    const revisions = await store.listRevisionsByVersion((inst.body.draft as { id: string }).id);
    expect(revisions.map((r) => r.title).sort()).toEqual(["Blog", "Homepage"]);
    expect(revisions.find((r) => r.title === "Homepage")?.acceptanceCriteria).toHaveLength(2);

    const missing = await fx.owner.agent
      .post(`/api/v1/projects/${fx.projectId}/scope-versions/draft/from-template`)
      .send({ templateId: "st_nope", name: "x" });
    expect(missing.status).toBe(404);
  });
});

describe("CSV requirement import", () => {
  const CSV = [
    "title,description,acceptanceCriteria,category,priority,stableKey",
    '"Login","SSO login","works | fast",Auth,HIGH,REQ-100',
    '"Export","CSV export","",Reports,LOW,',
  ].join("\n");

  it("dry-runs without writing, then imports atomically", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    const { draftId } = await draftScope(fx.owner.agent, fx.projectId);

    const preview = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/requirements/import`).send({
      draftVersionId: draftId,
      csv: CSV,
      dryRun: true,
    });
    expect(preview.status).toBe(200);
    expect(CsvImportResponseSchema.safeParse(preview.body).success).toBe(true);
    expect(preview.body).toMatchObject({ dryRun: true, totalRows: 2, validRows: 2, imported: 0, errors: [] });
    expect(await store.listRequirements(fx.projectId)).toHaveLength(2);

    const imported = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/requirements/import`).send({
      draftVersionId: draftId,
      csv: CSV,
      dryRun: false,
    });
    expect(imported.status).toBe(201);
    expect(imported.body).toMatchObject({ dryRun: false, imported: 2 });
    expect(imported.body.stableKeys).toContain("REQ-100");
    expect(await store.listRequirements(fx.projectId)).toHaveLength(4);
    const revisions = await store.listRevisionsByVersion(draftId);
    expect(revisions.find((r) => r.title === "Login")?.acceptanceCriteria).toEqual(["works", "fast"]);

    const events = await store.listAuditEvents({ projectId: fx.projectId, limit: 50 });
    expect(events.items.some((e) => e.action === "requirement.imported")).toBe(true);
  });

  it("reports per-row errors and imports nothing on failure", async () => {
    const { app, store } = createTestApp();
    const fx = await agencyFixture(app);
    const { draftId } = await draftScope(fx.owner.agent, fx.projectId);

    const bad = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/requirements/import`).send({
      draftVersionId: draftId,
      dryRun: false,
      csv: [
        "title,description,priority,stableKey",
        '"","Missing title",HIGH,REQ-200',
        '"Dup","First dup",LOW,REQ-201',
        '"Dup2","Second dup",LOW,REQ-201',
        '"Weird","Bad priority",URGENT,',
      ].join("\n"),
    });
    expect(bad.status).toBe(422);
    expect(CsvImportResponseSchema.safeParse(bad.body).success).toBe(true);
    expect(bad.body.imported).toBe(0);
    expect(bad.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 1, field: "title" }),
        expect.objectContaining({ row: 3, field: "stableKey" }),
        expect.objectContaining({ row: 4, field: "priority" }),
      ]),
    );
    expect(await store.listRequirements(fx.projectId)).toHaveLength(2);

    // Malformed CSV and missing columns are 422, not 500.
    const malformed = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/requirements/import`).send({
      draftVersionId: draftId,
      dryRun: true,
      csv: 'title,description\n"never closed, x',
    });
    expect(malformed.status).toBe(422);
    const noHeader = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/requirements/import`).send({
      draftVersionId: draftId,
      dryRun: true,
      csv: "name,notes\nfoo,bar",
    });
    expect(noHeader.status).toBe(422);
  });

  it("rejects non-draft targets, key collisions, and client writers", async () => {
    const { app } = createTestApp();
    const fx = await agencyFixture(app);
    const { draftId } = await draftScope(fx.owner.agent, fx.projectId);

    const forbidden = await fx.client.agent.post(`/api/v1/projects/${fx.projectId}/requirements/import`).send({
      draftVersionId: draftId,
      dryRun: true,
      csv: CSV,
    });
    expect(forbidden.status).toBe(403);

    // Explicit key colliding with an existing project key.
    const existing = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/requirements`).send({
      draftVersionId: draftId,
      title: "Taken",
      description: "Takes a key",
      stableKey: "REQ-300",
    });
    expect(existing.status).toBe(201);
    const collision = await fx.owner.agent.post(`/api/v1/projects/${fx.projectId}/requirements/import`).send({
      draftVersionId: draftId,
      dryRun: true,
      csv: "title,description,stableKey\n\"New\",\"Row\",REQ-300",
    });
    expect(collision.status).toBe(200);
    expect(collision.body.errors).toEqual([expect.objectContaining({ row: 1, field: "stableKey" })]);
  });
});

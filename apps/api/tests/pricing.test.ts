import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { agencyFixture, createTestApp, register, type TestApp } from "./helpers.js";
import { FileStore } from "../src/store/file-store.js";
import { MemoryStore } from "../src/store/memory.js";

let t: TestApp;

beforeEach(() => {
  t = createTestApp();
});

const RATES = [
  { role: "Senior Engineer", hourlyRateMinor: 8000 },
  { role: "Designer", hourlyRateMinor: 5000 },
];

describe("rate cards and estimate templates", () => {
  it("manages cards with a single default and blocks dup roles", async () => {
    const { app } = t;
    const fx = await agencyFixture(app);
    const first = await fx.owner.agent.post(`/api/v1/organizations/${fx.organizationId}/rate-cards`).send({
      name: "Standard 2026",
      currency: "USD",
      rates: RATES,
      isDefault: true,
    });
    expect(first.status).toBe(201);
    const second = await fx.owner.agent.post(`/api/v1/organizations/${fx.organizationId}/rate-cards`).send({
      name: "Enterprise",
      currency: "USD",
      rates: RATES,
      isDefault: true,
    });
    expect(second.status).toBe(201);
    const list = await fx.owner.agent.get(`/api/v1/organizations/${fx.organizationId}/rate-cards?limit=50`);
    expect(list.status).toBe(200);
    const cards = (list.body as { data: Array<{ id: string; isDefault: boolean }>; pagination: unknown }).data;
    expect(cards.filter((c) => c.isDefault).map((c) => c.id)).toEqual([(second.body as { id: string }).id]);

    const dup = await fx.owner.agent.post(`/api/v1/organizations/${fx.organizationId}/rate-cards`).send({
      name: "Broken",
      currency: "USD",
      rates: [{ role: "Designer", hourlyRateMinor: 1 }, { role: "Designer", hourlyRateMinor: 2 }],
    });
    expect(dup.status).toBe(422);

    const badCurrency = await fx.owner.agent.post(`/api/v1/organizations/${fx.organizationId}/rate-cards`).send({
      name: "Broken",
      currency: "usd",
      rates: RATES,
    });
    expect(badCurrency.status).toBe(400);
  });

  it("blocks card deletion and rate changes once impacts reference the card", async () => {
    const { app } = t;
    const fx = await agencyFixture(app);
    const card = await fx.owner.agent.post(`/api/v1/organizations/${fx.organizationId}/rate-cards`).send({
      name: "Standard",
      currency: "USD",
      rates: RATES,
    });
    const cardId = (card.body as { id: string }).id;

    // Price an impact with the card (manual project/change setup).
    const client = await fx.owner.agent.post("/api/v1/clients").send({ organizationId: fx.organizationId, name: "Globex" });
    const project = await fx.owner.agent.post("/api/v1/projects").send({
      organizationId: fx.organizationId,
      clientId: (client.body as { id: string }).id,
      name: "Priced",
      currency: "USD",
    });
    const projectId = (project.body as { id: string }).id;
    const created = await fx.owner.agent.post(`/api/v1/projects/${projectId}/change-requests`).send({
      title: "Priced work",
      description: "Priced work description",
      source: "AGENCY",
    });
    const changeId = (created.body as { id: string }).id;
    let version = (created.body as { version: number }).version;
    for (const status of ["SUBMITTED", "TRIAGING", "ESTIMATING"]) {
      const patched = await fx.owner.agent.patch(`/api/v1/change-requests/${changeId}`).send({ expectedVersion: version, status });
      version = (patched.body as { version: number }).version;
    }
    const impact = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/impact`).send({
      effortDays: 2,
      confidence: "HIGH",
      pricing: { rateCardId: cardId, lineItems: [{ label: "Build", role: "Senior Engineer", hours: 10 }] },
    });
    expect(impact.status).toBe(201);
    expect((impact.body as { priceMinor: number }).priceMinor).toBe(80000);
    expect((impact.body as { pricing: { mode: string } }).pricing.mode).toBe("COMPUTED");

    const del = await fx.owner.agent.delete(`/api/v1/rate-cards/${cardId}`);
    expect(del.status).toBe(409);
    const rerate = await fx.owner.agent.patch(`/api/v1/rate-cards/${cardId}`).send({
      rates: [{ role: "Senior Engineer", hourlyRateMinor: 1 }],
    });
    expect(rerate.status).toBe(409);
    const rename = await fx.owner.agent.patch(`/api/v1/rate-cards/${cardId}`).send({ name: "Standard v1 (frozen)" });
    expect(rename.status).toBe(200);
  });

  it("computes template pricing with contingency and tax, and records overrides", async () => {
    const { app } = t;
    const fx = await agencyFixture(app);
    const card = await fx.owner.agent.post(`/api/v1/organizations/${fx.organizationId}/rate-cards`).send({
      name: "Standard",
      currency: "USD",
      rates: RATES,
    });
    const cardId = (card.body as { id: string }).id;
    const template = await fx.owner.agent.post(`/api/v1/organizations/${fx.organizationId}/estimate-templates`).send({
      name: "Feature",
      items: [
        { label: "Build", role: "Senior Engineer", hours: 10 },
        { label: "Mockups", role: "Designer", hours: 4 },
      ],
      contingencyPct: 10,
      taxPct: 5,
    });
    expect(template.status).toBe(201);
    const templateId = (template.body as { id: string }).id;

    const client = await fx.owner.agent.post("/api/v1/clients").send({ organizationId: fx.organizationId, name: "Globex" });
    const project = await fx.owner.agent.post("/api/v1/projects").send({
      organizationId: fx.organizationId,
      clientId: (client.body as { id: string }).id,
      name: "Priced",
      currency: "USD",
    });
    const projectId = (project.body as { id: string }).id;
    async function estimating(title: string): Promise<string> {
      const created = await fx.owner.agent.post(`/api/v1/projects/${projectId}/change-requests`).send({
        title,
        description: `${title} description`,
        source: "AGENCY",
      });
      const changeId = (created.body as { id: string }).id;
      let version = (created.body as { version: number }).version;
      for (const status of ["SUBMITTED", "TRIAGING", "ESTIMATING"]) {
        const patched = await fx.owner.agent.patch(`/api/v1/change-requests/${changeId}`).send({ expectedVersion: version, status });
        version = (patched.body as { version: number }).version;
      }
      return changeId;
    }

    // Template items apply when lineItems are omitted: 100000 +10% +5% = 115500.
    const fromTemplate = await fx.owner.agent.post(`/api/v1/change-requests/${await estimating("Templated")}/impact`).send({
      effortDays: 14,
      confidence: "MEDIUM",
      pricing: { rateCardId: cardId, templateId },
    });
    expect(fromTemplate.status).toBe(201);
    const templatedBody = fromTemplate.body as { priceMinor: number; pricing: { computedMinor: number; contingencyMinor: number; taxMinor: number; templateName: string } };
    expect(templatedBody.priceMinor).toBe(115500);
    expect(templatedBody.pricing.computedMinor).toBe(115500);
    expect(templatedBody.pricing.contingencyMinor).toBe(10000);
    expect(templatedBody.pricing.taxMinor).toBe(5500);
    expect(templatedBody.pricing.templateName).toBe("Feature");

    // Override replaces the price but keeps the computed snapshot + reason.
    const overridden = await fx.owner.agent.post(`/api/v1/change-requests/${await estimating("Overridden")}/impact`).send({
      effortDays: 2,
      confidence: "HIGH",
      pricing: { rateCardId: cardId, lineItems: [{ label: "Build", role: "Senior Engineer", hours: 10 }] },
      override: { priceMinor: 70000, reason: "Goodwill discount for a repeat client" },
    });
    expect(overridden.status).toBe(201);
    const overriddenBody = overridden.body as { priceMinor: number; overrideReason: string; pricing: { mode: string; computedMinor: number } };
    expect(overriddenBody.priceMinor).toBe(70000);
    expect(overriddenBody.overrideReason).toBe("Goodwill discount for a repeat client");
    expect(overriddenBody.pricing.mode).toBe("OVERRIDE");
    expect(overriddenBody.pricing.computedMinor).toBe(80000);

    // Negative paths.
    const both = await fx.owner.agent.post(`/api/v1/change-requests/${await estimating("Both")}/impact`).send({
      priceMinor: 1,
      pricing: { rateCardId: cardId, lineItems: [{ label: "Build", role: "Senior Engineer", hours: 1 }] },
    });
    expect(both.status).toBe(422);
    const orphan = await fx.owner.agent.post(`/api/v1/change-requests/${await estimating("Orphan")}/impact`).send({
      override: { priceMinor: 1, reason: "no pricing" },
    });
    expect(orphan.status).toBe(422);
    const unknownRole = await fx.owner.agent.post(`/api/v1/change-requests/${await estimating("Unknown")}/impact`).send({
      pricing: { rateCardId: cardId, lineItems: [{ label: "Magic", role: "Wizard", hours: 1 }] },
    });
    expect(unknownRole.status).toBe(422);
    const badPct = await fx.owner.agent.post(`/api/v1/organizations/${fx.organizationId}/estimate-templates`).send({
      name: "Bad",
      items: [{ label: "Build", role: "Senior Engineer", hours: 1 }],
      contingencyPct: 101,
    });
    expect(badPct.status).toBe(400);
  });

  it("scopes cards by org role: staff views, admins manage, clients denied, outsiders 404", async () => {
    const { app } = t;
    const fx = await agencyFixture(app);
    const card = await fx.owner.agent.post(`/api/v1/organizations/${fx.organizationId}/rate-cards`).send({
      name: "Standard",
      currency: "USD",
      rates: RATES,
    });
    const cardId = (card.body as { id: string }).id;

    const member = await register(app, { email: "member@agency.test", organizationName: "Temp" });
    const inviteMember = await fx.owner.agent.post(`/api/v1/organizations/${fx.organizationId}/invitations`).send({ email: member.user.email, role: "MEMBER" });
    await member.agent.post(`/api/v1/auth/invitations/${(inviteMember.body as { token: string }).token}/accept`).send({});
    expect((await member.agent.get(`/api/v1/organizations/${fx.organizationId}/rate-cards`)).status).toBe(200);
    expect((await member.agent.get(`/api/v1/rate-cards/${cardId}`)).status).toBe(200);
    expect((await member.agent.post(`/api/v1/organizations/${fx.organizationId}/rate-cards`).send({ name: "X", currency: "USD", rates: RATES })).status).toBe(403);

    expect((await fx.client.agent.get(`/api/v1/organizations/${fx.organizationId}/rate-cards`)).status).toBe(403);
    expect((await fx.client.agent.get(`/api/v1/rate-cards/${cardId}`)).status).toBe(403);

    // Cross-org card id probe: 404, no disclosure.
    const outsider = await register(app, { email: "outsider@evil.test", organizationName: "Evil" });
    expect((await outsider.agent.get(`/api/v1/rate-cards/${cardId}`)).status).toBe(404);
    expect((await outsider.agent.get(`/api/v1/organizations/${fx.organizationId}/rate-cards`)).status).toBe(404);

    // Wrong-org card rejected in pricing, and currency must match the project.
    const evilCard = await outsider.agent.post(`/api/v1/organizations/${outsider.organization.id}/rate-cards`).send({
      name: "Evil",
      currency: "USD",
      rates: RATES,
    });
    const client = await fx.owner.agent.post("/api/v1/clients").send({ organizationId: fx.organizationId, name: "Globex" });
    const project = await fx.owner.agent.post("/api/v1/projects").send({
      organizationId: fx.organizationId,
      clientId: (client.body as { id: string }).id,
      name: "Priced",
      currency: "USD",
    });
    const projectId = (project.body as { id: string }).id;
    const created = await fx.owner.agent.post(`/api/v1/projects/${projectId}/change-requests`).send({
      title: "X",
      description: "X description",
      source: "AGENCY",
    });
    const changeId = (created.body as { id: string }).id;
    let version = (created.body as { version: number }).version;
    for (const status of ["SUBMITTED", "TRIAGING", "ESTIMATING"]) {
      const patched = await fx.owner.agent.patch(`/api/v1/change-requests/${changeId}`).send({ expectedVersion: version, status });
      version = (patched.body as { version: number }).version;
    }
    const foreign = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/impact`).send({
      pricing: { rateCardId: (evilCard.body as { id: string }).id, lineItems: [{ label: "B", role: "Senior Engineer", hours: 1 }] },
    });
    expect(foreign.status).toBe(404);
    const eurCard = await fx.owner.agent.post(`/api/v1/organizations/${fx.organizationId}/rate-cards`).send({
      name: "Euro",
      currency: "EUR",
      rates: RATES,
    });
    const mismatch = await fx.owner.agent.post(`/api/v1/change-requests/${changeId}/impact`).send({
      pricing: { rateCardId: (eurCard.body as { id: string }).id, lineItems: [{ label: "B", role: "Senior Engineer", hours: 1 }] },
    });
    expect(mismatch.status).toBe(422);
  });

  it("rolls back card writes on transaction failure and persists them to disk", async () => {
    const store = new MemoryStore();
    await expect(
      store.transaction(async (tx) => {
        await tx.createRateCard({ organizationId: "org_1", name: "Doomed", currency: "USD", isDefault: false, createdBy: "u", rates: RATES });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await store.listRateCards("org_1")).toEqual([]);

    const dir = mkdtempSync(join(tmpdir(), "scopelock-cards-"));
    const file = join(dir, "cards.json");
    const first = new FileStore(file);
    const card = await first.createRateCard({ organizationId: "org_1", name: "Kept", currency: "USD", isDefault: true, createdBy: "u", rates: RATES });
    await first.createEstimateTemplate({ organizationId: "org_1", name: "T", items: [{ label: "B", role: "Senior Engineer", hours: 2 }], contingencyPct: 5, taxPct: null, createdBy: "u" });
    const reopened = new FileStore(file);
    expect((await reopened.findRateCardById(card.id))?.rates).toHaveLength(2);
    expect(await reopened.listEstimateTemplates("org_1")).toHaveLength(1);
  });
});

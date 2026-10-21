import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PASSWORD = "password1234";

test("scope check advises but never blocks, in intake and in-app", async ({ page, context }) => {
  const stamp = Date.now();
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Scope Owner");
  await page.getByLabel("Email").fill(`scopec-${stamp}@test.dev`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Organization name").fill("Scope Org");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  const me = await page.request.get("/api/v1/auth/me");
  const orgId = ((await me.json()) as { organizations: Array<{ id: string }> }).organizations[0]?.id as string;
  const clientRes = await page.request.post("/api/v1/clients", { data: { organizationId: orgId, name: "Globex" } });
  const clientId = ((await clientRes.json()) as { id: string }).id;
  const projectRes = await page.request.post("/api/v1/projects", {
    data: { organizationId: orgId, clientId, name: "Scope project", currency: "USD" },
  });
  const projectId = ((await projectRes.json()) as { id: string }).id;

  // Published baseline with a homepage requirement to match against.
  const draft = await page.request.post(`/api/v1/projects/${projectId}/scope-versions/draft`, { data: { title: "Baseline" } });
  const draftId = ((await draft.json()) as { id: string }).id;
  await page.request.post(`/api/v1/projects/${projectId}/requirements`, {
    data: { draftVersionId: draftId, title: "Homepage", description: "Marketing homepage with hero section and testimonials", acceptanceCriteria: ["Homepage loads"], order: 0 },
  });
  const loaded = await page.request.get(`/api/v1/scope-versions/${draftId}`);
  await page.request.post(`/api/v1/scope-versions/${draftId}/publish`, { data: { expectedVersion: ((await loaded.json()) as { version: number }).version } });

  const link = await page.request.post(`/api/v1/projects/${projectId}/intake-links`, { data: { name: "Form" } });
  const publicPath = (((await link.json()) as { url: string }).url as string).replace(/^https?:\/\/[^/]+/, "");

  // Public form: overlapping text surfaces the baseline requirement, then submits anyway.
  const anon = await context.newPage();
  await anon.goto(publicPath);
  await anon.getByLabel("Title").fill("Homepage testimonials");
  await anon.getByLabel("Details").fill("Add a testimonials carousel to the homepage hero section for social proof.");
  await anon.getByRole("button", { name: "Check against agreed scope" }).click();
  await expect(anon.getByText("This might already be covered. Advisory only — submit anyway if none of these fit.")).toBeVisible();
  await expect(anon.getByText("REQ-001", { exact: false })).toBeVisible();
  const results = await new AxeBuilder({ page: anon }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, JSON.stringify(serious.map((x) => ({ id: x.id, nodes: x.nodes.length })), null, 2)).toEqual([]);
  await anon.getByRole("button", { name: "Send request" }).click();
  await expect(anon.getByText(/Received — reference CHG-/)).toBeVisible();
  await anon.close();

  // In-app: the new-change dialog offers the same advisory check.
  await page.goto(`/projects/${projectId}`);
  await page.getByRole("button", { name: "New change request" }).first().click();
  await page.getByLabel("Title", { exact: true }).fill("Homepage video");
  await page.getByLabel("Description", { exact: true }).fill("Embed a product video in the homepage hero section below the testimonials.");
  await page.getByRole("button", { name: "Check against agreed scope" }).click();
  await expect(page.getByText("This might already be covered. Advisory only — submit anyway if none of these fit.")).toBeVisible();
  await page.getByRole("button", { name: "Create as draft" }).click();
  await expect(page.getByText("Homepage video")).toBeVisible();
});

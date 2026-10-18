import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PASSWORD = "password1234";

async function axeClean(page: Parameters<Parameters<typeof test>[1]>[0]["page"]): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, JSON.stringify(serious.map((x) => ({ id: x.id, nodes: x.nodes.length })), null, 2)).toEqual([]);
}

test("delivery acceptance: request on scope, decide on review link", async ({ page }) => {
  const stamp = Date.now();
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Accept Owner");
  await page.getByLabel("Email").fill(`accept-${stamp}@test.dev`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Organization name").fill("Accept Org");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  const me = await page.request.get("/api/v1/auth/me");
  const meJson = (await me.json()) as { organizations: Array<{ id: string }> };
  const orgId = meJson.organizations[0]?.id as string;

  const clientRes = await page.request.post("/api/v1/clients", { data: { organizationId: orgId, name: "Globex" } });
  const clientId = ((await clientRes.json()) as { id: string }).id;
  const projectRes = await page.request.post("/api/v1/projects", {
    data: { organizationId: orgId, clientId, name: "Accept project", currency: "USD" },
  });
  const projectId = ((await projectRes.json()) as { id: string }).id;

  // Configure the deemed-acceptance window through the Policy tab.
  await page.goto(`/projects/${projectId}`);
  await page.getByRole("tab", { name: "Policy" }).click();
  await page.locator("#policy-deemed-days").fill("7");
  await page.getByRole("button", { name: "Save deemed window" }).click();
  await expect(page.getByText("Thresholds saved.")).toBeVisible();

  // Publish a baseline, deliver one requirement, attach evidence.
  const draft = await page.request.post(`/api/v1/projects/${projectId}/scope-versions/draft`, { data: { title: "Baseline" } });
  const draftId = ((await draft.json()) as { id: string }).id;
  for (const [i, title] of ["Homepage", "Blog"].entries()) {
    await page.request.post(`/api/v1/projects/${projectId}/requirements`, {
      data: { draftVersionId: draftId, title, description: `${title} description`, acceptanceCriteria: [`${title} works`], order: i },
    });
  }
  const loaded = await page.request.get(`/api/v1/scope-versions/${draftId}`);
  const version = ((await loaded.json()) as { version: number }).version;
  await page.request.post(`/api/v1/scope-versions/${draftId}/publish`, { data: { expectedVersion: version } });
  const reqList = await page.request.get(`/api/v1/projects/${projectId}/requirements`);
  const reqs = ((await reqList.json()) as { data: Array<{ id: string; stableKey: string }> }).data;
  const reqId = reqs[0]?.id as string;
  for (const status of ["IN_PROGRESS", "DELIVERED"]) {
    await page.request.patch(`/api/v1/requirements/${reqId}`, { data: { status } });
  }
  await page.request.post(`/api/v1/requirements/${reqId}/evidence`, {
    data: { type: "NOTE", title: "Demo recording", note: "Walked through on staging." },
  });

  // Request acceptance from the scope page; the deadline defaults to the window.
  await page.goto(`/projects/${projectId}/scope`);
  await expect(page.getByRole("button", { name: "Request acceptance" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Request acceptance" }).first().click();
  await page.getByRole("checkbox", { name: /Accept Owner/ }).check();
  await page.getByRole("button", { name: "Send acceptance package" }).click();
  await expect(page.getByRole("link", { name: "Open review link" })).toBeVisible();
  await axeClean(page);
  const href = (await page.getByRole("link", { name: "Open review link" }).first().getAttribute("href")) as string;

  // Decide on the review link: deliverables, criteria, and evidence render.
  await page.goto(href);
  await expect(page.getByRole("heading", { name: /Deliverables for acceptance/ })).toBeVisible();
  await expect(page.getByText("Homepage works")).toBeVisible();
  await expect(page.getByText("Demo recording")).toBeVisible();
  await page.getByRole("radio", { name: "APPROVED" }).check();
  await page.getByLabel("Comment (optional)").fill("Works as specified.");
  await page.getByRole("checkbox", { name: /I confirm this decision/ }).check();
  await page.getByRole("button", { name: "Record decision" }).click();
  await expect(page.getByText("DECIDED", { exact: true })).toBeVisible();
  await axeClean(page);

  // The delivery is accepted.
  const after = await page.request.get(`/api/v1/projects/${projectId}/requirements`);
  const rows = ((await after.json()) as { data: Array<{ id: string; status: string }> }).data;
  expect(rows.find((r) => r.id === reqId)?.status).toBe("ACCEPTED");
});

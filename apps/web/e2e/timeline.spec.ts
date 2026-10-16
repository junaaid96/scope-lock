import { expect, test } from "@playwright/test";

const PASSWORD = "password1234";

test("timeline shows baselines and changes in order", async ({ page }) => {
  const stamp = Date.now();
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Timeline User");
  await page.getByLabel("Email").fill(`timeline-${stamp}@test.dev`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Organization name").fill("Timeline Org");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  const me = await page.request.get("/api/v1/auth/me");
  const orgId = ((await me.json()) as { organizations: Array<{ id: string }> }).organizations[0]?.id as string;
  const clientRes = await page.request.post("/api/v1/clients", { data: { organizationId: orgId, name: "Globex" } });
  const clientId = ((await clientRes.json()) as { id: string }).id;
  const projectRes = await page.request.post("/api/v1/projects", {
    data: { organizationId: orgId, clientId, name: "Website relaunch" },
  });
  const projectId = ((await projectRes.json()) as { id: string }).id;

  const draft = await page.request.post(`/api/v1/projects/${projectId}/scope-versions/draft`, { data: { title: "Baseline" } });
  const draftId = ((await draft.json()) as { id: string }).id;
  await page.request.post(`/api/v1/projects/${projectId}/requirements`, {
    data: { draftVersionId: draftId, title: "Homepage", description: "Homepage description", acceptanceCriteria: ["Works"] },
  });
  const loaded = await page.request.get(`/api/v1/scope-versions/${draftId}`);
  const publish = await page.request.post(`/api/v1/scope-versions/${draftId}/publish`, {
    data: { expectedVersion: ((await loaded.json()) as { version: number }).version },
  });
  expect(publish.ok()).toBeTruthy();
  const changeRes = await page.request.post(`/api/v1/projects/${projectId}/change-requests`, {
    data: { title: "Add testimonials", description: "Carousel on the homepage", source: "CLIENT" },
  });
  expect(changeRes.ok()).toBeTruthy();
  const number = ((await changeRes.json()) as { number: string }).number;

  await page.goto(`/projects/${projectId}/timeline`);
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Baseline milestones" })).toContainText("Baseline v1");
  await expect(page.getByText(`Baseline v1 published — Baseline`)).toBeVisible();
  await expect(page.getByText(`${number} submitted — Add testimonials`)).toBeVisible();

  // Filters narrow the visible entries.
  await page.getByRole("button", { name: "Milestones", exact: true }).click();
  await expect(page.getByText(`${number} submitted — Add testimonials`)).toHaveCount(0);
  await expect(page.getByText(`Baseline v1 published — Baseline`)).toBeVisible();
});

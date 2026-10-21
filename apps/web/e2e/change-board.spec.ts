import { expect, test } from "@playwright/test";

const PASSWORD = "password1234";

test("change board moves a request between stages", async ({ page }) => {
  const stamp = Date.now();
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Board User");
  await page.getByLabel("Email").fill(`board-${stamp}@test.dev`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Organization name").fill("Board Org");
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
  const changeRes = await page.request.post(`/api/v1/projects/${projectId}/change-requests`, {
    data: { title: "Add testimonials", description: "Carousel on the homepage", source: "CLIENT" },
  });
  expect(changeRes.ok()).toBeTruthy();
  const change = (await changeRes.json()) as { id: string; version: number; number: string };
  const submit = await page.request.patch(`/api/v1/change-requests/${change.id}`, {
    data: { expectedVersion: change.version, status: "SUBMITTED" },
  });
  expect(submit.ok()).toBeTruthy();

  await page.goto(`/projects/${projectId}`);
  await page.getByRole("tab", { name: "Board" }).click();
  const triage = page.locator('section[aria-label^="Triage"]');
  await expect(triage.getByText(`${change.number}: Add testimonials`)).toBeVisible();

  // Move SUBMITTED → TRIAGING via the card's Move control; the card stays in Triage with the new badge.
  await page.getByLabel(`Move ${change.number} to another status`).selectOption("TRIAGING");
  await expect(triage.getByText("Triaging")).toBeVisible();

  // Illegal drops explain themselves instead of failing silently.
  const card = triage.locator("li", { hasText: change.number }).first();
  const pending = page.locator('section[aria-label^="Pending approval"]');
  await card.dragTo(pending);
  await expect(page.getByRole("alert")).toContainText("via Send for approval");
  await expect(triage.getByText(`${change.number}: Add testimonials`)).toBeVisible();
});

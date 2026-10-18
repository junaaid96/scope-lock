import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PASSWORD = "password1234";

async function axeClean(page: Parameters<Parameters<typeof test>[1]>[0]["page"]): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, JSON.stringify(serious.map((x) => ({ id: x.id, nodes: x.nodes.length })), null, 2)).toEqual([]);
}

test("audit integrity card recomputes the project hash chain", async ({ page }) => {
  const stamp = Date.now();
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Chain Owner");
  await page.getByLabel("Email").fill(`chain-${stamp}@test.dev`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Organization name").fill("Chain Org");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  const me = await page.request.get("/api/v1/auth/me");
  const meJson = (await me.json()) as { organizations: Array<{ id: string }> };
  const orgId = meJson.organizations[0]?.id as string;

  const clientRes = await page.request.post("/api/v1/clients", { data: { organizationId: orgId, name: "Globex" } });
  const clientId = ((await clientRes.json()) as { id: string }).id;
  const projectRes = await page.request.post("/api/v1/projects", {
    data: { organizationId: orgId, clientId, name: "Chain project", currency: "USD" },
  });
  const projectId = ((await projectRes.json()) as { id: string }).id;

  // Generate chained history: create + submit a change.
  const created = await page.request.post(`/api/v1/projects/${projectId}/change-requests`, {
    data: { title: "Chained work", description: "Chained work description", source: "AGENCY" },
  });
  const createdBody = (await created.json()) as { id: string; version: number };
  await page.request.patch(`/api/v1/change-requests/${createdBody.id}`, {
    data: { expectedVersion: createdBody.version, status: "SUBMITTED" },
  });

  await page.goto(`/projects/${projectId}/activity`);
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Audit integrity" })).toBeVisible();
  await page.getByRole("button", { name: "Verify chain" }).click();
  await expect(page.getByText("Chain valid")).toBeVisible();
  await expect(page.getByText(/chained events?/)).toBeVisible();
  await axeClean(page);
});

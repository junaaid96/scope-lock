import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PASSWORD = "password1234";

test("rate cards price an impact with template contingency and tax", async ({ page }) => {
  const stamp = Date.now();
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Pricing Owner");
  await page.getByLabel("Email").fill(`pricing-${stamp}@test.dev`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Organization name").fill("Pricing Org");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  const me = await page.request.get("/api/v1/auth/me");
  const orgId = ((await me.json()) as { organizations: Array<{ id: string }> }).organizations[0]?.id as string;

  // Org settings: create a rate card and a template through the UI.
  await page.goto(`/orgs/${orgId}/settings`);
  await page.getByRole("button", { name: "New rate card" }).click();
  await page.getByLabel("Card name").fill("Standard 2026");
  await page.getByLabel("Currency (ISO)").fill("USD");
  await page.getByLabel("Role 1").fill("Senior Engineer");
  await page.getByLabel("Hourly rate 1").fill("80");
  await page.getByRole("button", { name: "Add role" }).click();
  await page.getByLabel("Role 2").fill("Designer");
  await page.getByLabel("Hourly rate 2").fill("50");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Standard 2026")).toBeVisible();

  await page.getByRole("button", { name: "New template" }).click();
  await page.getByLabel("Template name").fill("Feature");
  await page.getByLabel("What 1").fill("Build");
  await page.getByLabel("Role 1").fill("Senior Engineer");
  await page.getByLabel("Hours 1").fill("10");
  await page.getByRole("button", { name: "Add line" }).click();
  await page.getByLabel("What 2").fill("Mockups");
  await page.getByLabel("Role 2").fill("Designer");
  await page.getByLabel("Hours 2").fill("4");
  await page.getByLabel("Contingency %").fill("10");
  await page.getByLabel("Tax % (optional)").fill("5");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Feature")).toBeVisible();

  // Fixtures: client, project, change driven to ESTIMATING.
  const clientRes = await page.request.post("/api/v1/clients", { data: { organizationId: orgId, name: "Globex" } });
  const clientId = ((await clientRes.json()) as { id: string }).id;
  const projectRes = await page.request.post("/api/v1/projects", {
    data: { organizationId: orgId, clientId, name: "Priced project", currency: "USD" },
  });
  const projectId = ((await projectRes.json()) as { id: string }).id;
  const created = await page.request.post(`/api/v1/projects/${projectId}/change-requests`, {
    data: { title: "Priced work", description: "Priced work description", source: "AGENCY" },
  });
  const createdJson = (await created.json()) as { id: string; version: number };
  let v = createdJson.version;
  for (const status of ["SUBMITTED", "TRIAGING", "ESTIMATING"]) {
    const patched = await page.request.patch(`/api/v1/change-requests/${createdJson.id}`, { data: { expectedVersion: v, status } });
    v = ((await patched.json()) as { version: number }).version;
  }

  // Record a computed impact: template prefill + server-side total.
  await page.goto(`/projects/${projectId}/changes/${createdJson.id}`);
  await page.getByRole("button", { name: "Record impact" }).click();
  await page.getByRole("radio", { name: "From rate card" }).check();
  await expect(page.getByLabel("Rate card", { exact: true })).toBeVisible();
  await page.getByLabel("Template (optional)").selectOption({ label: "Feature" });
  await expect(page.getByLabel("What 1")).toHaveValue("Build");
  await expect(page.getByLabel("Hours 2")).toHaveValue("4");
  await page.getByRole("button", { name: "Save impact" }).click();
  await expect(page.getByText("Price breakdown")).toBeVisible();
  await expect(page.getByText("$1,155.00").first()).toBeVisible();

  // Override the computed price with a recorded reason.
  await page.getByRole("button", { name: "Record impact" }).click();
  await page.getByRole("radio", { name: "From rate card" }).check();
  await page.getByLabel("Override the computed price").check();
  await page.getByLabel("Override price (major units)").fill("700");
  await page.getByLabel("Override reason").fill("Goodwill discount");
  await page.getByRole("button", { name: "Save impact" }).click();
  await expect(page.getByText("$700.00")).toBeVisible();
  await expect(page.getByText("Overridden: Goodwill discount")).toBeVisible();

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, JSON.stringify(serious.map((x) => ({ id: x.id, nodes: x.nodes.length })), null, 2)).toEqual([]);
});

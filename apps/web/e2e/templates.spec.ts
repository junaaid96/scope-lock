import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PASSWORD = "password1234";

async function axeClean(page: Parameters<Parameters<typeof test>[1]>[0]["page"]): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, JSON.stringify(serious.map((x) => ({ id: x.id, nodes: x.nodes.length })), null, 2)).toEqual([]);
}

test("templates: library template starts a draft, CSV imports with per-row errors", async ({ page }) => {
  const stamp = Date.now();
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Template Owner");
  await page.getByLabel("Email").fill(`templates-${stamp}@test.dev`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Organization name").fill("Templates Org");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  const me = await page.request.get("/api/v1/auth/me");
  const meJson = (await me.json()) as { organizations: Array<{ id: string }> };
  const orgId = meJson.organizations[0]?.id as string;
  const client = await page.request.post("/api/v1/clients", { data: { organizationId: orgId, name: "Tpl Client" } });
  const clientId = ((await client.json()) as { id: string }).id;
  const project = await page.request.post("/api/v1/projects", {
    data: { organizationId: orgId, clientId, name: "Tpl Project" },
  });
  const projectId = ((await project.json()) as { id: string }).id;

  // Create a template through the settings UI.
  await page.goto(`/orgs/${orgId}/settings`);
  const scopeCard = page.locator("section").filter({ hasText: "Scope templates" });
  await scopeCard.getByRole("button", { name: "New scope template" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Website starter");
  await page.getByLabel("Project type").fill("Website");
  await page.getByLabel("Assumptions (one per line)").fill("Client provides copy");
  await page.getByLabel("Exclusions (one per line)").fill("Native mobile apps");
  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByLabel("Title", { exact: true }).fill("Homepage");
  await page.getByLabel("Description", { exact: true }).fill("Marketing landing page");
  await page.getByRole("button", { name: "Create template" }).click();
  await expect(page.getByText("1 requirement · 1 assumption · 1 exclusion")).toBeVisible();

  // Start a draft from the template on the Scope page.
  await page.goto(`/projects/${projectId}/scope`);
  await page.getByRole("button", { name: "From template…" }).click();
  await page.getByLabel("Template", { exact: true }).selectOption({ label: "Website starter (Website, 1 items)" });
  await expect(page.getByText("Starts a draft with 1 requirements, 1 assumptions, and 1 exclusions.")).toBeVisible();
  await page.getByRole("button", { name: "Create draft", exact: true }).click();
  await expect(page.getByText("Marketing landing page")).toBeVisible();
  await expect(page.getByText("Client provides copy")).toBeVisible();

  // CSV import: preview flags the bad row, blocks import until fixed.
  await page.getByRole("button", { name: "Import CSV…" }).click();
  await page.getByLabel(/CSV \(title and description required/).fill(
    "title,description,priority\nLogin,SSO login,HIGH\n,Broken row,LOW\n",
  );
  await page.getByRole("button", { name: "Preview (dry run)" }).click();
  await expect(page.getByText("Preview: 1 of 2 rows valid")).toBeVisible();
  await expect(page.getByText("Row 2 · title:")).toBeVisible();
  await expect(page.getByRole("button", { name: "Import", exact: true })).toBeDisabled();
  await page.getByLabel(/CSV \(title and description required/).fill("title,description,priority\nLogin,SSO login,HIGH\n");
  await page.getByRole("button", { name: "Preview (dry run)" }).click();
  await expect(page.getByText("Preview: 1 of 1 rows valid")).toBeVisible();
  await page.getByRole("button", { name: "Import 1 rows" }).click();
  await expect(page.getByText(/Imported: 1 of 1 rows valid · 1 imported/)).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("SSO login")).toBeVisible();

  await axeClean(page);
});

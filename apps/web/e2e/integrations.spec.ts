import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PASSWORD = "password1234";

async function axeClean(page: Parameters<Parameters<typeof test>[1]>[0]["page"]): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, JSON.stringify(serious.map((x) => ({ id: x.id, nodes: x.nodes.length })), null, 2)).toEqual([]);
}

test("integrations: API key lifecycle and webhook CRUD on org settings", async ({ page }) => {
  const stamp = Date.now();
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Integrations Owner");
  await page.getByLabel("Email").fill(`integrations-${stamp}@test.dev`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Organization name").fill("Integrations Org");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  const me = await page.request.get("/api/v1/auth/me");
  const meJson = (await me.json()) as { organizations: Array<{ id: string }> };
  const orgId = meJson.organizations[0]?.id as string;
  await page.goto(`/orgs/${orgId}/settings`);
  await expect(page.getByRole("heading", { name: "API keys" })).toBeVisible();

  // Create a key: the secret is shown once.
  await page.getByRole("button", { name: "New API key" }).click();
  const keyDialog = page.getByRole("dialog", { name: "New API key" });
  await keyDialog.getByLabel("Key name").fill("Nightly export");
  await keyDialog.getByRole("button", { name: "Create key" }).click();
  const secretDialog = page.getByRole("dialog", { name: "Copy your secret now" });
  await expect(secretDialog).toBeVisible();
  const secret = await secretDialog.locator("input").inputValue();
  expect(secret).toMatch(/^sk_/);
  await secretDialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByText("Nightly export")).toBeVisible();
  expect(await page.getByText(secret, { exact: true }).count()).toBe(0);

  // The secret is never shown again, even after reload.
  await page.reload();
  await expect(page.getByText("Nightly export")).toBeVisible();
  expect(await page.getByText(secret, { exact: true }).count()).toBe(0);

  // Rotate issues a new secret; revoke marks the key revoked.
  const keyRow = page.getByText("Nightly export");
  const keyItem = page.locator("li", { has: keyRow });
  await keyItem.getByRole("button", { name: "Rotate" }).click();
  await keyItem.getByRole("button", { name: "Rotate", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Copy your secret now" })).toBeVisible();
  const rotated = await page.getByRole("dialog", { name: "Copy your secret now" }).locator("input").inputValue();
  expect(rotated).toMatch(/^sk_/);
  expect(rotated).not.toBe(secret);
  await page.getByRole("dialog", { name: "Copy your secret now" }).getByRole("button", { name: "Close", exact: true }).click();
  await keyItem.getByRole("button", { name: "Revoke" }).click();
  await keyItem.getByRole("button", { name: "Revoke", exact: true }).click();
  // Rotate leaves the revoked predecessor listed under the same name, so pin
  // the assertion to the rotated key's row via its unique prefix.
  const rotatedRow = page.locator("li", { hasText: rotated.slice(0, 11) });
  await expect(rotatedRow.getByText("Revoked")).toBeVisible();

  // Webhook CRUD with an HMAC signing secret shown once.
  await page.getByRole("button", { name: "New webhook" }).click();
  const hookDialog = page.getByRole("dialog", { name: "New webhook" });
  await hookDialog.getByLabel("Target URL").fill("http://127.0.0.1:9/scopelock-events");
  await hookDialog.getByRole("button", { name: "Create webhook" }).click();
  const hookSecretDialog = page.getByRole("dialog", { name: "Copy your secret now" });
  await expect(hookSecretDialog).toBeVisible();
  const hookSecret = await hookSecretDialog.locator("input").inputValue();
  expect(hookSecret.length).toBeGreaterThan(20);
  await hookSecretDialog.getByRole("button", { name: "Close", exact: true }).click();
  const hookItem = page.locator("li", { hasText: "http://127.0.0.1:9/scopelock-events" });
  await expect(hookItem).toBeVisible();

  // Delivery log starts empty; rotating the secret shows a new one once.
  await hookItem.getByRole("button", { name: "Deliveries" }).click();
  await expect(hookItem.getByText("No deliveries yet.")).toBeVisible();
  await hookItem.getByRole("button", { name: "Rotate secret" }).click();
  await hookItem.getByRole("button", { name: "Rotate secret", exact: true }).click();
  const rotatedHook = page.getByRole("dialog", { name: "Copy your secret now" });
  await expect(rotatedHook).toBeVisible();
  expect(await rotatedHook.locator("input").inputValue()).not.toBe(hookSecret);
  await rotatedHook.getByRole("button", { name: "Close", exact: true }).click();

  // Disable via edit, then delete.
  await hookItem.getByRole("button", { name: "Edit" }).click();
  const editDialog = page.getByRole("dialog", { name: "Edit webhook" });
  await editDialog.getByText("Enabled", { exact: true }).click();
  await editDialog.getByRole("button", { name: "Save webhook" }).click();
  await expect(hookItem.getByText("Disabled")).toBeVisible();
  await hookItem.getByRole("button", { name: "Delete" }).click();
  await hookItem.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("http://127.0.0.1:9/scopelock-events")).toHaveCount(0);

  await axeClean(page);
});

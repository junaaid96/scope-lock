import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PASSWORD = "password1234";

async function axeClean(page: Parameters<Parameters<typeof test>[1]>[0]["page"]): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, JSON.stringify(serious.map((x) => ({ id: x.id, nodes: x.nodes.length })), null, 2)).toEqual([]);
}

test("channels: preferences persist and Slack connects", async ({ page }) => {
  const stamp = Date.now();
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Channels Owner");
  await page.getByLabel("Email").fill(`channels-${stamp}@test.dev`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Organization name").fill("Channels Org");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  const me = await page.request.get("/api/v1/auth/me");
  const meJson = (await me.json()) as { organizations: Array<{ id: string }> };
  const orgId = meJson.organizations[0]?.id as string;
  await page.goto(`/orgs/${orgId}/settings`);
  await expect(page.getByRole("heading", { name: "Your notification channels" })).toBeVisible();

  // Preferences: phone + toggles persist across reload.
  await page.getByLabel("Phone number").fill("+880 1712-345678");
  await page.getByText("SMS", { exact: true }).click();
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByText("Preferences saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Phone number")).toHaveValue("+8801712345678");

  // Invalid phones are rejected with the server message.
  await page.getByLabel("Phone number").fill("01712");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByText("Phone number must be E.164")).toBeVisible();

  // Slack: connect shows Connected; disconnect reverts to the form.
  await page.getByLabel("Webhook URL").fill("http://127.0.0.1:9/hook");
  await page.getByRole("button", { name: "Connect Slack" }).click();
  await expect(page.getByText("Connected", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Disconnect" }).click();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByRole("button", { name: "Connect Slack" })).toBeVisible();

  await axeClean(page);
});

import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PASSWORD = "password1234";

async function axeClean(page: Parameters<Parameters<typeof test>[1]>[0]["page"]): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, JSON.stringify(serious.map((x) => ({ id: x.id, nodes: x.nodes.length })), null, 2)).toEqual([]);
}

test("approval escalation: configure delay and target on the Policy tab", async ({ page }) => {
  const stamp = Date.now();
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Escalation Owner");
  await page.getByLabel("Email").fill(`escalate-${stamp}@test.dev`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Organization name").fill("Escalate Org");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  const me = await page.request.get("/api/v1/auth/me");
  const meJson = (await me.json()) as { organizations: Array<{ id: string }> };
  const orgId = meJson.organizations[0]?.id as string;

  const clientRes = await page.request.post("/api/v1/clients", { data: { organizationId: orgId, name: "Globex" } });
  const clientId = ((await clientRes.json()) as { id: string }).id;
  const projectRes = await page.request.post("/api/v1/projects", {
    data: { organizationId: orgId, clientId, name: "Escalate project", currency: "USD" },
  });
  const projectId = ((await projectRes.json()) as { id: string }).id;

  await page.goto(`/projects/${projectId}`);
  await page.getByRole("tab", { name: "Policy" }).click();
  await expect(page.locator("#policy-escalation-hours")).toHaveValue("");
  await expect(page.locator("#policy-escalation-target")).toHaveValue("AGENCY_LEAD");

  // Invalid delays are rejected client-side.
  await page.locator("#policy-escalation-hours").fill("0");
  await page.getByRole("button", { name: "Save escalation" }).click();
  await expect(page.getByText("Enter 1–720 hours, or leave blank to disable.")).toBeVisible();

  // A valid delay + target persists across reloads.
  await page.locator("#policy-escalation-hours").fill("48");
  await page.locator("#policy-escalation-target").selectOption("SECOND_APPROVER");
  await page.getByRole("button", { name: "Save escalation" }).click();
  await expect(page.getByText("Thresholds saved.")).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "Policy" }).click();
  await expect(page.locator("#policy-escalation-hours")).toHaveValue("48");
  await expect(page.locator("#policy-escalation-target")).toHaveValue("SECOND_APPROVER");
  await axeClean(page);
});

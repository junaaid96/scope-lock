import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PASSWORD = "password1234";

test("inbound mailbox receives simulated email as an unverified change", async ({ page }) => {
  const stamp = Date.now();
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Inbound Owner");
  await page.getByLabel("Email").fill(`inbound-${stamp}@test.dev`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Organization name").fill("Inbound Org");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  const me = await page.request.get("/api/v1/auth/me");
  const orgId = ((await me.json()) as { organizations: Array<{ id: string }> }).organizations[0]?.id as string;
  const clientRes = await page.request.post("/api/v1/clients", { data: { organizationId: orgId, name: "Globex" } });
  const clientId = ((await clientRes.json()) as { id: string }).id;
  const projectRes = await page.request.post("/api/v1/projects", {
    data: { organizationId: orgId, clientId, name: "Inbound project", currency: "USD" },
  });
  const projectId = ((await projectRes.json()) as { id: string }).id;

  await page.goto(`/projects/${projectId}`);
  await page.getByRole("tab", { name: "Intake" }).click();
  await page.getByRole("button", { name: "New mailbox" }).click();
  await page.getByLabel("Name (staff only)").fill("Support");
  await page.getByRole("button", { name: "Create mailbox" }).click();
  await expect(page.getByText(/chg-[0-9a-f]{24}@/)).toBeVisible();

  await page.getByRole("button", { name: "Simulate email…" }).click();
  await page.getByLabel("Subject").fill("Add a booking calendar");
  await page.getByLabel("Body").fill("We need a booking calendar on the contact page so visitors can pick a slot without calling us.");
  await page.getByRole("button", { name: "Send test email" }).click();
  await expect(page.getByText(/Created CHG-/)).toBeVisible();

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, JSON.stringify(serious.map((x) => ({ id: x.id, nodes: x.nodes.length })), null, 2)).toEqual([]);

  await page.goto(`/projects/${projectId}`);
  await page.getByText("Add a booking calendar").click();
  await expect(page.getByText("Unverified submitter")).toBeVisible();
  await expect(page.getByText("Source: Inbound email")).toBeVisible();
});

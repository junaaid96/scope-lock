import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PASSWORD = "password1234";

async function axeClean(page: Parameters<Parameters<typeof test>[1]>[0]["page"]): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, JSON.stringify(serious.map((x) => ({ id: x.id, nodes: x.nodes.length })), null, 2)).toEqual([]);
}

test("public intake link accepts submissions and revokes cleanly", async ({ page, context }) => {
  const stamp = Date.now();
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Intake Owner");
  await page.getByLabel("Email").fill(`intake-${stamp}@test.dev`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Organization name").fill("Intake Org");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  const me = await page.request.get("/api/v1/auth/me");
  const orgId = ((await me.json()) as { organizations: Array<{ id: string }> }).organizations[0]?.id as string;
  const clientRes = await page.request.post("/api/v1/clients", { data: { organizationId: orgId, name: "Globex" } });
  const clientId = ((await clientRes.json()) as { id: string }).id;
  const projectRes = await page.request.post("/api/v1/projects", {
    data: { organizationId: orgId, clientId, name: "Intake project", currency: "USD" },
  });
  const projectId = ((await projectRes.json()) as { id: string }).id;

  // Staff creates a link through the UI; the token shows once.
  await page.goto(`/projects/${projectId}`);
  await page.getByRole("tab", { name: "Intake" }).click();
  await page.getByRole("button", { name: "New intake link" }).click();
  await page.getByLabel("Name (staff only)").fill("Website form");
  await page.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByText("Link ready — copy it now (shown once)")).toBeVisible();
  const urlText = (await page.getByText(/\/intake\//).first().textContent()) as string;
  const publicPath = urlText.replace(/^https?:\/\/[^/]+/, "");
  expect(publicPath).toMatch(/^\/intake\//);
  await expect(page.getByText("<iframe", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();

  // Anonymous visitor submits through the public form (fresh context, no session).
  const anon = await context.newPage();
  await anon.goto(publicPath);
  await expect(anon.getByText("Request a change")).toBeVisible();
  await axeClean(anon);
  await anon.getByLabel("Title").fill("Add a booking calendar");
  await anon.getByLabel("Details").fill("We need a booking calendar on the contact page so visitors can pick a slot without calling us.");
  await anon.getByLabel("Your name (optional)").fill("Pat Visitor");
  await anon.getByLabel("Email for follow-ups (optional)").fill("pat@example.com");
  await anon.getByRole("button", { name: "Send request" }).click();
  await expect(anon.getByText(/Received — reference CHG-/)).toBeVisible();
  await anon.close();

  // Staff sees the SUBMITTED change flagged as unverified.
  await page.goto(`/projects/${projectId}`);
  await page.getByRole("tab", { name: "Changes" }).click();
  await page.getByText("Add a booking calendar").click();
  await expect(page.getByText("Unverified submitter")).toBeVisible();
  await expect(page.getByText(/Self-declared contact: Pat Visitor · pat@example.com/)).toBeVisible();
  await expect(page.getByText("SUBMITTED", { exact: true }).first()).toBeVisible();

  // Revoking kills the public form.
  await page.goto(`/projects/${projectId}`);
  await page.getByRole("tab", { name: "Intake" }).click();
  await page.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText("REVOKED")).toBeVisible();
  const anon2 = await context.newPage();
  await anon2.goto(publicPath);
  await expect(anon2.getByText("Form unavailable")).toBeVisible();
  await anon2.close();
});

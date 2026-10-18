import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PASSWORD = "password1234";

test("transcript import proposes drafts and accepts them as changes", async ({ page }) => {
  const stamp = Date.now();
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Import Owner");
  await page.getByLabel("Email").fill(`import-${stamp}@test.dev`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Organization name").fill("Import Org");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  const me = await page.request.get("/api/v1/auth/me");
  const orgId = ((await me.json()) as { organizations: Array<{ id: string }> }).organizations[0]?.id as string;
  const clientRes = await page.request.post("/api/v1/clients", { data: { organizationId: orgId, name: "Globex" } });
  const clientId = ((await clientRes.json()) as { id: string }).id;
  const projectRes = await page.request.post("/api/v1/projects", {
    data: { organizationId: orgId, clientId, name: "Import project", currency: "USD" },
  });
  const projectId = ((await projectRes.json()) as { id: string }).id;

  await page.goto(`/projects/${projectId}`);
  await page.getByRole("button", { name: "Import from text…" }).click();
  await page.getByLabel("Paste the transcript or thread").fill(
    "Hi team, can we get SSO login please? Also need CSV export on the reports page. Thanks!",
  );
  await page.getByRole("button", { name: "Propose drafts" }).click();
  // With a provider key: drafts arrive with excerpts. Without one: graceful fallback.
  const acceptBtn = page.getByRole("button", { name: "Accept as draft" }).first();
  const fallbackMsg = page.getByText("AI provider is not configured; enter change requests manually.");
  await expect(acceptBtn.or(fallbackMsg)).toBeVisible({ timeout: 60_000 });
  if (await fallbackMsg.isVisible()) {
    await page.getByRole("button", { name: "Done" }).click();
    const changes = await page.request.get(`/api/v1/projects/${projectId}/change-requests?limit=50`);
    expect(((await changes.json()) as { data: unknown[] }).data).toHaveLength(0);
    return;
  }

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, JSON.stringify(serious.map((x) => ({ id: x.id, nodes: x.nodes.length })), null, 2)).toEqual([]);

  // Accept the first draft (edited), skip the rest, finish.
  await page.getByLabel("Title").first().fill("SSO login via e2e");
  await page.getByRole("button", { name: "Accept as draft" }).first().click();
  await expect(page.getByText("Accepted as a draft change ✓").first()).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();

  await expect(page.getByText("SSO login via e2e")).toBeVisible();
  const changes = await page.request.get(`/api/v1/projects/${projectId}/change-requests?limit=50`);
  expect(((await changes.json()) as { data: unknown[] }).data).toHaveLength(1);
});

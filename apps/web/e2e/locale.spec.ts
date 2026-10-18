import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PASSWORD = "password1234";

async function axeClean(page: Parameters<Parameters<typeof test>[1]>[0]["page"]): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, JSON.stringify(serious.map((x) => ({ id: x.id, nodes: x.nodes.length })), null, 2)).toEqual([]);
}

async function register(page: Parameters<Parameters<typeof test>[1]>[0]["page"], email: string): Promise<string> {
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Locale User");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Organization name").fill("Locale Org");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  const me = await page.request.get("/api/v1/auth/me");
  const meJson = (await me.json()) as { organizations: Array<{ id: string }> };
  return meJson.organizations[0]?.id as string;
}

test("locale: switch to Bangla, persist across reload, review links follow org default", async ({ page }) => {
  const stamp = Date.now();
  const orgId = await register(page, `locale-${stamp}@test.dev`);

  // Default is English.
  await expect(page.locator("html")).toHaveAttribute("lang", "en");

  // Switch to Bangla from the header; chrome translates and <html lang> follows.
  await page.getByLabel("Language").selectOption("bn");
  await expect(page.getByRole("heading", { name: "প্রকল্পসমূহ" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "bn");
  await expect(page.getByRole("link", { name: "ইনবক্স" }).first()).toBeVisible();
  await axeClean(page);

  // Per-user preference survives a reload.
  await page.reload();
  await expect(page.getByRole("heading", { name: "প্রকল্পসমূহ" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "bn");

  // Switch back to English for the setup below.
  await page.getByLabel("ভাষা").selectOption("en");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  // Org review-link default to Bangla (auto-saves).
  await page.goto(`/orgs/${orgId}/settings`);
  await page.locator("#org-locale").selectOption("bn");

  // Project + priced change + approval request, all via API.
  const clientRes = await page.request.post("/api/v1/clients", { data: { organizationId: orgId, name: "Globex" } });
  const clientId = ((await clientRes.json()) as { id: string }).id;
  const projectRes = await page.request.post("/api/v1/projects", {
    data: { organizationId: orgId, clientId, name: "Locale project", currency: "USD" },
  });
  const projectId = ((await projectRes.json()) as { id: string }).id;
  const created = await page.request.post(`/api/v1/projects/${projectId}/change-requests`, {
    data: { title: "Localised launch", description: "Localised launch description", source: "AGENCY" },
  });
  const body = (await created.json()) as { id: string; version: number };
  let v = body.version;
  for (const status of ["SUBMITTED", "TRIAGING", "ESTIMATING"]) {
    const patched = await page.request.patch(`/api/v1/change-requests/${body.id}`, {
      data: {
        expectedVersion: v,
        status,
        ...(status === "TRIAGING" ? { classification: "POTENTIAL_CHANGE", classificationRationale: "New work" } : {}),
      },
    });
    v = ((await patched.json()) as { version: number }).version;
  }
  await page.request.post(`/api/v1/change-requests/${body.id}/impact`, {
    data: { effortDays: 2, priceMinor: 50000, timelineDays: 3, confidence: "HIGH" },
  });
  const meSelf = await page.request.get("/api/v1/auth/me");
  const selfId = ((await meSelf.json()) as { user: { id: string } }).user.id;
  const send = await page.request.post(`/api/v1/change-requests/${body.id}/approval-requests`, {
    data: { approverUserIds: [selfId], expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
  });
  expect(send.status()).toBe(201);
  const reviewUrl = (((await send.json()) as { reviewUrls: string[] }).reviewUrls[0] as string).replace(
    /^https?:\/\/[^/]+/,
    "",
  );

  // The public review page renders in Bangla from the org default (user pref is English).
  await page.goto(reviewUrl);
  await expect(page.getByText("রিভিউ").first()).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "bn");
  await axeClean(page);

  // The public decision certificate follows the same default.
  const approvalId = ((await send.json()) as { approval: { id: string } }).approval.id;
  await page.goto(`/verify/${approvalId}`);
  await expect(page.getByRole("heading", { name: "সিদ্ধান্তের সনদ" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "bn");
  await axeClean(page);
});

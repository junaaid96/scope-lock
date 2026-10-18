import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PASSWORD = "password1234";

async function axeClean(page: Parameters<Parameters<typeof test>[1]>[0]["page"]): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, JSON.stringify(serious.map((x) => ({ id: x.id, nodes: x.nodes.length })), null, 2)).toEqual([]);
}

test("memory: decided change is searchable with a verbatim excerpt and link", async ({ page }) => {
  const stamp = Date.now();
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Memory Owner");
  await page.getByLabel("Email").fill(`memory-${stamp}@test.dev`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Organization name").fill("Memory Org");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  const me = await page.request.get("/api/v1/auth/me");
  const meJson = (await me.json()) as { user: { id: string }; organizations: Array<{ id: string }> };
  const orgId = meJson.organizations[0]?.id as string;

  const client = await page.request.post("/api/v1/clients", { data: { organizationId: orgId, name: "Memory Client" } });
  const clientId = ((await client.json()) as { id: string }).id;
  const project = await page.request.post("/api/v1/projects", {
    data: { organizationId: orgId, clientId, name: "Memory Project" },
  });
  const projectId = ((await project.json()) as { id: string }).id;

  const created = await page.request.post(`/api/v1/projects/${projectId}/change-requests`, {
    data: { title: "Zebra-striped onboarding checklist", description: "Zebra-striped onboarding checklist for new tenants", source: "AGENCY" },
  });
  const changeId = ((await created.json()) as { id: string }).id;
  let version = ((await created.json()) as { version: number }).version;
  for (const status of ["SUBMITTED", "TRIAGING", "ESTIMATING"]) {
    const res = await page.request.patch(`/api/v1/change-requests/${changeId}`, {
      data: {
        expectedVersion: version,
        status,
        ...(status === "TRIAGING" ? { classification: "POTENTIAL_CHANGE", classificationRationale: "New work" } : {}),
      },
    });
    expect(res.ok()).toBe(true);
    version = ((await res.json()) as { version: number }).version;
  }
  const impact = await page.request.post(`/api/v1/change-requests/${changeId}/impact`, {
    data: { effortDays: 2, priceMinor: 50000, timelineDays: 3, confidence: "HIGH" },
  });
  expect(impact.ok()).toBe(true);
  const sent = await page.request.post(`/api/v1/change-requests/${changeId}/approval-requests`, {
    data: { approverUserIds: [meJson.user.id], expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
  });
  expect(sent.ok()).toBe(true);
  const reviewUrls = ((await sent.json()) as { reviewUrls: string[] }).reviewUrls;
  const token = (reviewUrls[0] as string).split("/review/")[1] as string;
  const decided = await page.request.post(`/api/v1/approval-requests/${token}/decisions`, {
    data: { decision: "APPROVED", confirm: true },
  });
  expect(decided.ok()).toBe(true);

  await page.goto("/");
  await page.getByPlaceholder("Search decided changes…").fill("Zebra-striped");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText(/1 past decision · lexical match/)).toBeVisible();
  const hit = page.getByRole("link", { name: /Zebra-striped onboarding checklist/ });
  await expect(hit).toBeVisible();
  await expect(page.getByText("Zebra-striped onboarding checklist for new tenants")).toBeVisible();
  await hit.click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/changes/${changeId}`));

  await axeClean(page);
});

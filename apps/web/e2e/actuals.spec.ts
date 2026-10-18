import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PASSWORD = "password1234";

async function axeClean(page: Parameters<Parameters<typeof test>[1]>[0]["page"]): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, JSON.stringify(serious.map((x) => ({ id: x.id, nodes: x.nodes.length })), null, 2)).toEqual([]);
}

test("actuals: suggestions show real prices, actuals feed the report", async ({ page }) => {
  const stamp = Date.now();
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Actuals Owner");
  await page.getByLabel("Email").fill(`actuals-${stamp}@test.dev`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Organization name").fill("Actuals Org");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  const me = await page.request.get("/api/v1/auth/me");
  const meJson = (await me.json()) as { user: { id: string }; organizations: Array<{ id: string }> };
  const orgId = meJson.organizations[0]?.id as string;
  const client = await page.request.post("/api/v1/clients", { data: { organizationId: orgId, name: "Actuals Client" } });
  const clientId = ((await client.json()) as { id: string }).id;
  const project = await page.request.post("/api/v1/projects", {
    data: { organizationId: orgId, clientId, name: "Actuals Project" },
  });
  const projectId = ((await project.json()) as { id: string }).id;

  async function estimated(title: string, description: string, priceMinor: number): Promise<string> {
    const created = await page.request.post(`/api/v1/projects/${projectId}/change-requests`, {
      data: { title, description, source: "AGENCY" },
    });
    expect(created.ok()).toBe(true);
    const body = (await created.json()) as { id: string; version: number };
    let version = body.version;
    for (const status of ["SUBMITTED", "TRIAGING", "ESTIMATING"]) {
      const res = await page.request.patch(`/api/v1/change-requests/${body.id}`, {
        data: {
          expectedVersion: version,
          status,
          ...(status === "TRIAGING" ? { classification: "POTENTIAL_CHANGE", classificationRationale: "New work" } : {}),
        },
      });
      expect(res.ok()).toBe(true);
      version = ((await res.json()) as { version: number }).version;
    }
    const impact = await page.request.post(`/api/v1/change-requests/${body.id}/impact`, {
      data: { effortDays: 4, priceMinor, timelineDays: 5, confidence: "HIGH" },
    });
    expect(impact.ok()).toBe(true);
    return body.id;
  }

  async function approveAndImplement(changeId: string): Promise<void> {
    const sent = await page.request.post(`/api/v1/change-requests/${changeId}/approval-requests`, {
      data: { approverUserIds: [meJson.user.id], expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
    });
    expect(sent.ok()).toBe(true);
    const token = (((await sent.json()) as { reviewUrls: string[] }).reviewUrls[0] as string).split("/review/")[1];
    const decided = await page.request.post(`/api/v1/approval-requests/${token}/decisions`, {
      data: { decision: "APPROVED", confirm: true },
    });
    expect(decided.ok()).toBe(true);
    const detail = await page.request.get(`/api/v1/change-requests/${changeId}`);
    const version = ((await detail.json()) as { version: number }).version;
    const implemented = await page.request.post(`/api/v1/change-requests/${changeId}/implement`, {
      data: { expectedVersion: version },
    });
    expect(implemented.ok()).toBe(true);
  }

  // Comparable: approved + implemented with a real price.
  const compId = await estimated("Salesmen mobile dashboard", "Route orders and collection targets on phones", 95000);
  await approveAndImplement(compId);

  // Target at ESTIMATING sees the comparable with its real approved price.
  const targetId = await estimated("Salesmen tablet dashboard", "Route overview on tablets", 80000);
  await page.goto(`/projects/${projectId}/changes/${targetId}`);
  await expect(page.getByRole("heading", { name: "Similar approved work" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Salesmen mobile dashboard/ })).toBeVisible();
  await expect(page.getByText("$950.00")).toBeVisible();

  // Implement the target, record actuals through the UI, read the report.
  await approveAndImplement(targetId);
  await page.goto(`/projects/${projectId}/changes/${targetId}`);
  await expect(page.getByRole("heading", { name: "Actuals", exact: true })).toBeVisible();
  await page.getByLabel("Actual effort (days)").fill("5");
  await page.getByLabel("Actual price (USD)").fill("990");
  await page.getByRole("button", { name: "Save actuals" }).click();
  await expect(page.getByText("Actuals saved.")).toBeVisible();

  await page.goto(`/projects/${projectId}`);
  await page.getByRole("tab", { name: "Actuals" }).click();
  await expect(page.getByText("1 of 2 implemented changes have recorded actuals.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Salesmen tablet dashboard/ })).toBeVisible();
  await expect(page.getByText("$190.00 (+23.8%)")).toBeVisible();

  await axeClean(page);
});

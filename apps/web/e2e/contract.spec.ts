import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PASSWORD = "password1234";

test("contract tab derives value from approved changes", async ({ page }) => {
  const stamp = Date.now();
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Ledger Owner");
  await page.getByLabel("Email").fill(`ledger-${stamp}@test.dev`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Organization name").fill("Ledger Org");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  // Fixtures via API: client, budgeted project, published baseline.
  const me = await page.request.get("/api/v1/auth/me");
  expect(me.ok()).toBeTruthy();
  const meJson = (await me.json()) as { user: { id: string }; organizations: Array<{ id: string }> };
  const orgId = meJson.organizations[0]?.id as string;
  const userId = meJson.user.id;
  const clientRes = await page.request.post("/api/v1/clients", { data: { organizationId: orgId, name: "Globex" } });
  expect(clientRes.ok()).toBeTruthy();
  const clientId = ((await clientRes.json()) as { id: string }).id;
  const projectRes = await page.request.post("/api/v1/projects", {
    data: { organizationId: orgId, clientId, name: "Ledger project", currency: "USD", budgetMinor: 100000 },
  });
  expect(projectRes.ok()).toBeTruthy();
  const projectId = ((await projectRes.json()) as { id: string }).id;
  const draftRes = await page.request.post(`/api/v1/projects/${projectId}/scope-versions/draft`, { data: { title: "Baseline" } });
  expect(draftRes.ok()).toBeTruthy();
  const draftId = ((await draftRes.json()) as { id: string }).id;
  for (const title of ["Homepage", "Blog"]) {
    const req = await page.request.post(`/api/v1/projects/${projectId}/requirements`, {
      data: { draftVersionId: draftId, title, description: `${title} description`, acceptanceCriteria: [`${title} works`] },
    });
    expect(req.ok()).toBeTruthy();
  }
  const loaded = await page.request.get(`/api/v1/scope-versions/${draftId}`);
  const publish = await page.request.post(`/api/v1/scope-versions/${draftId}/publish`, {
    data: { expectedVersion: ((await loaded.json()) as { version: number }).version },
  });
  expect(publish.ok()).toBeTruthy();

  async function driveChange(title: string, priceMinor: number, decide: boolean): Promise<string> {
    const created = await page.request.post(`/api/v1/projects/${projectId}/change-requests`, {
      data: { title, description: `${title} description`, source: "AGENCY" },
    });
    expect(created.ok()).toBeTruthy();
    const createdJson = (await created.json()) as { id: string; version: number; number: string };
    let v = createdJson.version;
    for (const status of ["SUBMITTED", "TRIAGING", "ESTIMATING"]) {
      const patched = await page.request.patch(`/api/v1/change-requests/${createdJson.id}`, { data: { expectedVersion: v, status } });
      expect(patched.ok()).toBeTruthy();
      v = ((await patched.json()) as { version: number }).version;
    }
    const impact = await page.request.post(`/api/v1/change-requests/${createdJson.id}/impact`, {
      data: { effortDays: 3, priceMinor, currency: "USD", confidence: "HIGH" },
    });
    expect(impact.ok()).toBeTruthy();
    const send = await page.request.post(`/api/v1/change-requests/${createdJson.id}/approval-requests`, {
      data: { approverUserIds: [userId], expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() },
    });
    expect(send.ok()).toBeTruthy();
    if (decide) {
      const approvalId = ((await send.json()) as { approval: { id: string } }).approval.id;
      const decision = await page.request.post(`/api/v1/approval-requests/${approvalId}/decisions`, {
        data: { decision: "APPROVED", confirm: true },
      });
      expect(decision.ok()).toBeTruthy();
    }
    return createdJson.number;
  }

  const approvedNumber = await driveChange("Priced addition", 25000, true);
  const pendingNumber = await driveChange("Awaiting decision", 40000, false);

  // Contract tab renders the derived figures.
  await page.goto(`/projects/${projectId}`);
  await page.getByRole("tab", { name: "Contract" }).click();
  await expect(page.getByText("Current value")).toBeVisible();
  await expect(page.getByText("$1,250.00")).toBeVisible();
  await expect(page.getByText("$400.00").first()).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(approvedNumber) })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(pendingNumber) })).toBeVisible();

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, JSON.stringify(serious.map((v) => ({ id: v.id, nodes: v.nodes.length })), null, 2)).toEqual([]);

  // Org rollup strip on the dashboard.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Contract value" })).toBeVisible();
  await expect(page.getByText("$1,250.00").first()).toBeVisible();
});

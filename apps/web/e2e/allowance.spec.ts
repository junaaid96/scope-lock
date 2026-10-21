import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PASSWORD = "password1234";

async function axeClean(page: Parameters<Parameters<typeof test>[1]>[0]["page"]): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, JSON.stringify(serious.map((x) => ({ id: x.id, nodes: x.nodes.length })), null, 2)).toEqual([]);
}

test("allowance pool grants, draws down, and stays visible", async ({ page }) => {
  const stamp = Date.now();
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Allowance Owner");
  await page.getByLabel("Email").fill(`allowance-${stamp}@test.dev`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Organization name").fill("Allowance Org");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  const me = await page.request.get("/api/v1/auth/me");
  const meJson = (await me.json()) as { user: { id: string }; organizations: Array<{ id: string }> };
  const orgId = meJson.organizations[0]?.id as string;
  const selfId = meJson.user.id;

  const clientRes = await page.request.post("/api/v1/clients", { data: { organizationId: orgId, name: "Globex" } });
  const clientId = ((await clientRes.json()) as { id: string }).id;
  const projectRes = await page.request.post("/api/v1/projects", {
    data: { organizationId: orgId, clientId, name: "Allowance project", currency: "USD" },
  });
  const projectId = ((await projectRes.json()) as { id: string }).id;

  // Create a pool through the UI.
  await page.goto(`/projects/${projectId}`);
  await page.getByRole("tab", { name: "Allowance" }).click();
  await page.getByRole("button", { name: "New pool" }).click();
  await page.getByLabel("Name").fill("E2E buffer");
  await page.getByLabel("Total hours").fill("40");
  await page.getByLabel("Objection window (hours)").fill("72");
  await page.getByLabel(/Enabled \(disabled pools/).check();
  await page.getByRole("button", { name: "Create pool" }).click();
  await expect(page.getByText("E2E buffer")).toBeVisible();
  await expect(page.getByText("Proposed")).toBeVisible();

  // Grant the pool: send + decide through the public review link.
  const pools = await page.request.get(`/api/v1/projects/${projectId}/allowance-pools?limit=50`);
  const poolId = (((await pools.json()) as { data: Array<{ id: string }> }).data[0] as { id: string }).id;
  // The owner approves the grant as well as the change (single-user e2e).
  const grant = await page.request.post(`/api/v1/allowance-pools/${poolId}/approval-requests`, {
    data: { approverUserIds: [selfId], expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
  });
  expect(grant.status()).toBe(201);
  const reviewUrl = (((await grant.json()) as { reviewUrls: string[] }).reviewUrls[0] as string).replace(/^https?:\/\/[^/]+/, "");

  await page.goto(reviewUrl);
  await expect(page.getByText("Allowance grant terms")).toBeVisible();
  await expect(page.getByText("40 hours")).toBeVisible();
  await axeClean(page);
  await page.getByRole("radio", { name: "Approve" }).check();
  await page.getByLabel("Comment (optional)").fill("Agreed");
  await page.getByRole("checkbox", { name: /I confirm this decision/ }).check();
  await page.getByRole("button", { name: "Record decision" }).click();
  await expect(page.getByText("Decided:")).toBeVisible();
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();

  await page.goto(`/projects/${projectId}`);
  await page.getByRole("tab", { name: "Allowance" }).click();
  await expect(page.getByText("Active")).toBeVisible();

  // A linked change draws down on approval.
  const created = await page.request.post(`/api/v1/projects/${projectId}/change-requests`, {
    data: { title: "Pool-funded work", description: "Pool-funded work description", source: "AGENCY" },
  });
  const createdJson = (await created.json()) as { id: string; version: number };
  let v = createdJson.version;
  const submit = await page.request.post(`/api/v1/change-requests/${createdJson.id}/submit`, { data: { expectedVersion: v } });
  v = ((await submit.json()) as { version: number }).version;
  for (const status of ["TRIAGING", "ESTIMATING"]) {
    const patched = await page.request.patch(`/api/v1/change-requests/${createdJson.id}`, { data: { expectedVersion: v, status } });
    v = ((await patched.json()) as { version: number }).version;
  }
  await page.request.post(`/api/v1/change-requests/${createdJson.id}/impact`, {
    data: { effortDays: 2, priceMinor: 50000, confidence: "MEDIUM" },
  });
  const send = await page.request.post(`/api/v1/change-requests/${createdJson.id}/approval-requests`, {
    data: { approverUserIds: [selfId], expiresAt: new Date(Date.now() + 86_400_000).toISOString(), allowancePoolId: poolId },
  });
  expect(send.status()).toBe(201);
  const changeToken = (((await send.json()) as { reviewUrls: string[] }).reviewUrls[0] as string).split("/review/")[1] as string;
  const decide = await page.request.post(`/api/v1/approval-requests/${changeToken}/decisions`, {
    data: { decision: "APPROVED", comment: "ok", confirm: true },
  });
  expect(decide.status()).toBe(201);

  await page.goto(`/projects/${projectId}`);
  await page.getByRole("tab", { name: "Allowance" }).click();
  await expect(page.getByText("Draw-downs (1)")).toBeVisible();
  await expect(page.getByText("Notified", { exact: true })).toBeVisible();
  await axeClean(page);

  await page.goto(`/projects/${projectId}/changes/${createdJson.id}`);
  await expect(page.getByText(/Allowance:/)).toBeVisible();
});

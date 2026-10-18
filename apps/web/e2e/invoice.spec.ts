import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PASSWORD = "password1234";

test("invoice-ready export downloads CSV and JSON lines", async ({ page }) => {
  const stamp = Date.now();
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Invoice Owner");
  await page.getByLabel("Email").fill(`invoice-${stamp}@test.dev`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Organization name").fill("Invoice Org");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  const me = await page.request.get("/api/v1/auth/me");
  const meJson = (await me.json()) as { user: { id: string }; organizations: Array<{ id: string }> };
  const orgId = meJson.organizations[0]?.id as string;
  const selfId = meJson.user.id;

  const clientRes = await page.request.post("/api/v1/clients", { data: { organizationId: orgId, name: "Globex" } });
  const clientId = ((await clientRes.json()) as { id: string }).id;
  const projectRes = await page.request.post("/api/v1/projects", {
    data: { organizationId: orgId, clientId, name: "Invoice project", currency: "USD" },
  });
  const projectId = ((await projectRes.json()) as { id: string }).id;

  const created = await page.request.post(`/api/v1/projects/${projectId}/change-requests`, {
    data: { title: "Billable, quoted work", description: "Billable work description", source: "AGENCY" },
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
    data: { effortDays: 2, priceMinor: 120000, confidence: "MEDIUM" },
  });
  const send = await page.request.post(`/api/v1/change-requests/${createdJson.id}/approval-requests`, {
    data: { approverUserIds: [selfId], expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
  });
  const changeToken = (((await send.json()) as { reviewUrls: string[] }).reviewUrls[0] as string).split("/review/")[1] as string;
  await page.request.post(`/api/v1/approval-requests/${changeToken}/decisions`, {
    data: { decision: "APPROVED", comment: "ok", confirm: true },
  });

  await page.goto(`/projects/${projectId}`);
  await page.getByRole("tab", { name: "Contract" }).click();
  await expect(page.getByText("Invoice-ready export")).toBeVisible();
  await page.getByLabel("From").fill("2020-01-01");

  const csvDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  const csv = await csvDownload;
  expect(csv.suggestedFilename()).toContain(".csv");
  const csvPath = await csv.path();
  const { readFileSync } = await import("node:fs");
  const csvText = readFileSync(csvPath as string, "utf8");
  expect(csvText.split("\n")[0]).toContain("price_minor");
  expect(csvText).toContain("120000");
  expect(csvText).toContain('"Billable, quoted work"');

  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download JSON" }).click();
  const json = await jsonDownload;
  const jsonPath = await json.path();
  const payload = JSON.parse(readFileSync(jsonPath as string, "utf8")) as {
    lines: Array<{ priceMinor: number }>;
    totals: Array<{ totalMinor: number }>;
  };
  expect(payload.lines).toHaveLength(1);
  expect(payload.lines[0]?.priceMinor).toBe(120000);
  expect(payload.totals[0]?.totalMinor).toBe(120000);

  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((x) => x.impact === "serious" || x.impact === "critical");
  expect(serious, JSON.stringify(serious.map((x) => ({ id: x.id, nodes: x.nodes.length })), null, 2)).toEqual([]);
});

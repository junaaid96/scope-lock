import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PASSWORD = "password1234";

async function axeClean(page: Parameters<Parameters<typeof test>[1]>[0]["page"]): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, JSON.stringify(serious.map((x) => ({ id: x.id, nodes: x.nodes.length })), null, 2)).toEqual([]);
}

test("change order PDF and public decision certificate", async ({ page }) => {
  const stamp = Date.now();
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Cert Owner");
  await page.getByLabel("Email").fill(`cert-${stamp}@test.dev`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Organization name").fill("Cert Org");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  const me = await page.request.get("/api/v1/auth/me");
  const meJson = (await me.json()) as { user: { id: string }; organizations: Array<{ id: string }> };
  const orgId = meJson.organizations[0]?.id as string;
  const selfId = meJson.user.id;

  const clientRes = await page.request.post("/api/v1/clients", { data: { organizationId: orgId, name: "Globex" } });
  const clientId = ((await clientRes.json()) as { id: string }).id;
  const projectRes = await page.request.post("/api/v1/projects", {
    data: { organizationId: orgId, clientId, name: "Cert project", currency: "USD" },
  });
  const projectId = ((await projectRes.json()) as { id: string }).id;

  const created = await page.request.post(`/api/v1/projects/${projectId}/change-requests`, {
    data: { title: "Audited upgrade", description: "Audited upgrade description", source: "AGENCY" },
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
  const send = await page.request.post(`/api/v1/change-requests/${body.id}/approval-requests`, {
    data: { approverUserIds: [selfId], expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
  });
  expect(send.status()).toBe(201);
  const sendBody = (await send.json()) as { approval: { id: string }; reviewUrls: string[] };
  const approvalId = sendBody.approval.id;
  const reviewUrl = (sendBody.reviewUrls[0] as string).replace(/^https?:\/\/[^/]+/, "");

  // Decide through the review page; the PDF link is offered there.
  await page.goto(reviewUrl);
  await expect(page.getByRole("link", { name: "Download change order (PDF)" })).toBeVisible();
  await page.getByRole("radio", { name: "APPROVED" }).check();
  await page.getByRole("checkbox", { name: /I confirm this decision/ }).check();
  await page.getByRole("button", { name: "Record decision" }).click();
  await expect(page.getByText("Decided:")).toBeVisible();

  // The change page links the same PDF; bytes are deterministic.
  await page.goto(`/projects/${projectId}/changes/${body.id}`);
  const pdfLink = page.getByRole("link", { name: "Change order (PDF)" });
  await expect(pdfLink).toBeVisible();
  const href = (await pdfLink.getAttribute("href")) as string;
  const first = await page.request.get(href);
  expect(first.status()).toBe(200);
  expect(first.headers()["content-type"]).toMatch(/application\/pdf/);
  const firstBytes = await first.body();
  expect(firstBytes.subarray(0, 4).toString()).toBe("%PDF");
  const second = await page.request.get(href);
  expect((await second.body()).equals(firstBytes)).toBe(true);

  // The public certificate recomputes the checksum and shows a match.
  await page.goto(`/verify/${approvalId}`);
  await expect(page.getByText("Checksum match")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Audited upgrade/ })).toBeVisible();
  await expect(page.getByText("APPROVED", { exact: true }).first()).toBeVisible();
  await axeClean(page);

  // Unknown certificates stay opaque.
  await page.goto("/verify/apr_doesnotexist000000");
  await expect(page.getByText("Certificate not found")).toBeVisible();
});

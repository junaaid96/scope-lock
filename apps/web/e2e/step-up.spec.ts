import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PASSWORD = "password1234";

async function axeClean(page: Parameters<Parameters<typeof test>[1]>[0]["page"]): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, JSON.stringify(serious.map((x) => ({ id: x.id, nodes: x.nodes.length })), null, 2)).toEqual([]);
}

test("step-up verification: configure, request code, and gate the decision", async ({ page }) => {
  const stamp = Date.now();
  await page.goto("/register");
  await page.getByLabel("Your name").fill("StepUp Owner");
  await page.getByLabel("Email").fill(`stepup-${stamp}@test.dev`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Organization name").fill("StepUp Org");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  const me = await page.request.get("/api/v1/auth/me");
  const meJson = (await me.json()) as { user: { id: string }; organizations: Array<{ id: string }> };
  const orgId = meJson.organizations[0]?.id as string;
  const selfId = meJson.user.id;

  // Workspace default: both checks on.
  await page.goto(`/orgs/${orgId}/settings`);
  await expect(page.getByRole("heading", { name: "Review step-up verification" })).toBeVisible();
  await page.getByRole("checkbox", { name: /Email code/ }).check();
  await page.getByRole("checkbox", { name: /Typed name/ }).check();
  await expect(page.getByRole("checkbox", { name: /Email code/ })).toBeChecked();
  await axeClean(page);

  const clientRes = await page.request.post("/api/v1/clients", { data: { organizationId: orgId, name: "Globex" } });
  const clientId = ((await clientRes.json()) as { id: string }).id;
  const projectRes = await page.request.post("/api/v1/projects", {
    data: { organizationId: orgId, clientId, name: "StepUp project", currency: "USD" },
  });
  const projectId = ((await projectRes.json()) as { id: string }).id;

  // Project inherits; pin both on explicitly through the Policy tab.
  await page.goto(`/projects/${projectId}`);
  await page.getByRole("tab", { name: "Policy" }).click();
  await expect(page.locator("#policy-stepup-otp")).toHaveValue("inherit");
  await page.locator("#policy-stepup-otp").selectOption("on");
  await page.locator("#policy-stepup-name").selectOption("on");
  await page.getByRole("button", { name: "Save policy" }).click();
  await expect(page.getByText("Thresholds saved.")).toBeVisible();
  await axeClean(page);

  const created = await page.request.post(`/api/v1/projects/${projectId}/change-requests`, {
    data: { title: "Guarded launch", description: "Guarded launch description", source: "AGENCY" },
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
  const reviewUrl = (((await send.json()) as { reviewUrls: string[] }).reviewUrls[0] as string).replace(
    /^https?:\/\/[^/]+/,
    "",
  );

  // The review form gates on code + name; a wrong code is rejected server-side.
  await page.goto(reviewUrl);
  await expect(page.getByText("Verify it is you")).toBeVisible();
  await expect(page.getByRole("button", { name: "Record decision" })).toBeDisabled();
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(page.getByText(/emailed a 6-digit code to .*@test\.dev/)).toBeVisible();
  await axeClean(page);
  await page.getByLabel("6-digit code").fill("000000");
  await page.getByLabel("Type your full name").fill("StepUp Owner");
  await page.getByRole("checkbox", { name: /I confirm this decision/ }).check();
  await expect(page.getByRole("button", { name: "Record decision" })).toBeEnabled();
  await page.getByRole("button", { name: "Record decision" }).click();
  await expect(page.getByText(/doesn't match/)).toBeVisible();
  // Clearing the name re-locks the form without a round trip.
  await page.getByLabel("Type your full name").fill("");
  await expect(page.getByRole("button", { name: "Record decision" })).toBeDisabled();
});

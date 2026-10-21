import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PASSWORD = "password1234";

async function axeClean(page: Parameters<Parameters<typeof test>[1]>[0]["page"]): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, JSON.stringify(serious.map((x) => ({ id: x.id, nodes: x.nodes.length })), null, 2)).toEqual([]);
}

test("proposal options: author, send, pick one, and park/revive", async ({ page }) => {
  const stamp = Date.now();
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Options Owner");
  await page.getByLabel("Email").fill(`options-${stamp}@test.dev`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Organization name").fill("Options Org");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  const me = await page.request.get("/api/v1/auth/me");
  const meJson = (await me.json()) as { user: { id: string }; organizations: Array<{ id: string }> };
  const orgId = meJson.organizations[0]?.id as string;
  const selfId = meJson.user.id;

  const clientRes = await page.request.post("/api/v1/clients", { data: { organizationId: orgId, name: "Globex" } });
  const clientId = ((await clientRes.json()) as { id: string }).id;
  const projectRes = await page.request.post("/api/v1/projects", {
    data: { organizationId: orgId, clientId, name: "Options project", currency: "USD" },
  });
  const projectId = ((await projectRes.json()) as { id: string }).id;

  const mkEstimating = async (title: string): Promise<string> => {
    const created = await page.request.post(`/api/v1/projects/${projectId}/change-requests`, {
      data: { title, description: `${title} description`, source: "AGENCY" },
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
    return body.id;
  };

  // Author two priced options through the change page (no base impact).
  const changeId = await mkEstimating("Tiered rollout");
  await page.goto(`/projects/${projectId}/changes/${changeId}`);
  await expect(page.getByRole("heading", { name: "Proposal options" })).toBeVisible();
  for (const [label, price, effort] of [["Full", "12000.00", "10"], ["Reduced", "4500.00", "4"]]) {
    await page.getByRole("button", { name: "Add option", exact: true }).click();
    await page.getByLabel("Label", { exact: true }).fill(label as string);
    await page.getByLabel("What this option covers").fill(`${label} variant of the rollout`);
    await page.getByLabel(/Price \(USD\)/).fill(price as string);
    await page.getByLabel("Effort (days)").fill(effort as string);
    await page.getByRole("button", { name: "Save option" }).click();
    await expect(page.getByText(`${label} ·`, { exact: false }).first()).toBeVisible();
  }
  await expect(page.getByText("2 of 4 options")).toBeVisible();
  await axeClean(page);

  // Options alone unblock sending; the client picks exactly one.
  const send = await page.request.post(`/api/v1/change-requests/${changeId}/approval-requests`, {
    data: { approverUserIds: [selfId], expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
  });
  expect(send.status()).toBe(201);
  const reviewUrl = (((await send.json()) as { reviewUrls: string[] }).reviewUrls[0] as string).replace(
    /^https?:\/\/[^/]+/,
    "",
  );
  await page.goto(reviewUrl);
  await expect(page.getByRole("heading", { name: "Proposal options — approve exactly one" })).toBeVisible();
  await expect(page.getByText(/Full · \$12,?000\.00/).first()).toBeVisible();
  await axeClean(page);
  // Approve requires a pick.
  await expect(page.getByRole("button", { name: "Record decision" })).toBeDisabled();
  await page.getByRole("radio", { name: /Reduced ·/ }).check();
  await expect(page.getByRole("button", { name: "Record decision" })).toBeDisabled();
  await page.getByRole("checkbox", { name: /I confirm this decision/ }).check();
  await page.getByRole("button", { name: "Record decision" }).click();
  await expect(page.getByText("Decided:")).toBeVisible();
  await expect(page.getByText(/option “Reduced”/)).toBeVisible();

  // The change page shows the pick; the effective impact prices it.
  await page.goto(`/projects/${projectId}/changes/${changeId}`);
  await expect(page.getByText("Chose option “Reduced”")).toBeVisible();
  await expect(page.getByText("Chosen by the client")).toBeVisible();

  // Park and revive through the status picker + parked filter.
  const parkedId = await mkEstimating("Later maybe");
  await page.goto(`/projects/${projectId}/changes/${parkedId}`);
  await page.getByLabel("Change status").selectOption("PARKED");
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByText("Parked", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/revive it into a new submission/)).toBeVisible();

  await page.goto(`/projects/${projectId}`);
  await page.locator("#changes-status").selectOption("PARKED");
  await expect(page.getByText("Later maybe")).toBeVisible();
  await expect(page.getByText("Tiered rollout")).toHaveCount(0);
  await page.getByRole("tab", { name: "Board" }).click();
  await expect(page.getByRole("heading", { name: "Parked" })).toBeVisible();

  await page.goto(`/projects/${projectId}/changes/${parkedId}`);
  await page.getByLabel("Change status").selectOption("SUBMITTED");
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByText("Submitted", { exact: true }).first()).toBeVisible();
});

import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PASSWORD = "password1234";

async function axeClean(page: Parameters<Parameters<typeof test>[1]>[0]["page"]): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, JSON.stringify(serious.map((x) => ({ id: x.id, nodes: x.nodes.length })), null, 2)).toEqual([]);
}

test("github linking: connect, observe a merged PR, and flag health", async ({ page }) => {
  const stamp = Date.now();
  await page.goto("/register");
  await page.getByLabel("Your name").fill("GitHub Owner");
  await page.getByLabel("Email").fill(`github-${stamp}@test.dev`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Organization name").fill("GitHub Org");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  const me = await page.request.get("/api/v1/auth/me");
  const meJson = (await me.json()) as { organizations: Array<{ id: string }> };
  const orgId = meJson.organizations[0]?.id as string;
  const clientRes = await page.request.post("/api/v1/clients", { data: { organizationId: orgId, name: "Globex" } });
  const clientId = ((await clientRes.json()) as { id: string }).id;
  const projectRes = await page.request.post("/api/v1/projects", {
    data: { organizationId: orgId, clientId, name: "GitHub project", currency: "USD" },
  });
  const projectId = ((await projectRes.json()) as { id: string }).id;
  const changeRes = await page.request.post(`/api/v1/projects/${projectId}/change-requests`, {
    data: { title: "Tracked work", description: "Tracked work description", source: "AGENCY" },
  });
  const changeNumber = ((await changeRes.json()) as { number: string }).number;

  await page.goto(`/projects/${projectId}`);
  await page.getByRole("tab", { name: "Integrations" }).click();
  await expect(page.getByRole("heading", { name: "GitHub linking" })).toBeVisible();

  // Opt in, then connect: the webhook URL and secret show once.
  await page.getByText("Enable external integrations for this project").click();
  await page.getByRole("button", { name: "Connect GitHub" }).click();
  const secretDialog = page.getByRole("dialog", { name: "Copy the webhook secret now" });
  await expect(secretDialog).toBeVisible();
  const webhookUrl = await secretDialog.getByLabel("Webhook URL").inputValue();
  expect(webhookUrl).toContain("/api/v1/webhooks/github/");
  const connectionId = webhookUrl.split("/api/v1/webhooks/github/")[1] as string;
  const secret = await secretDialog.locator('input[aria-label="Copy the webhook secret now"]').inputValue();
  expect(secret).toMatch(/^ghsec_/);
  await secretDialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByText("Connected")).toBeVisible();

  // A signed merged-PR delivery referencing the change is observed + linked.
  const pr = {
    action: "closed",
    repository: { full_name: "octo/repo", default_branch: "main" },
    pull_request: {
      number: 31,
      title: `Ship ${changeNumber}`,
      html_url: "https://github.com/octo/repo/pull/31",
      merged: true,
      merged_at: "2026-03-03T00:00:00Z",
      head: { ref: "main" },
    },
  };
  const raw = JSON.stringify(pr);
  const sig = `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  const delivery = await page.request.post(`/api/v1/webhooks/github/${connectionId}`, {
    headers: { "X-Hub-Signature-256": sig, "X-GitHub-Delivery": `e2e-${stamp}`, "X-GitHub-Event": "pull_request", "Content-Type": "application/json" },
    data: raw,
  });
  expect(delivery.ok()).toBe(true);
  expect((await delivery.json()) as { status: string }).toMatchObject({ status: "ok", observed: 1, merged: 1, linked: 1 });

  // An unlinked merged PR lands in the work list too.
  const orphan = {
    action: "closed",
    repository: { full_name: "octo/repo", default_branch: "main" },
    pull_request: {
      number: 32, title: "Drive-by fix", html_url: "https://github.com/octo/repo/pull/32",
      merged: true, merged_at: "2026-03-03T00:00:00Z", head: { ref: "main" },
    },
  };
  const orphanRaw = JSON.stringify(orphan);
  await page.request.post(`/api/v1/webhooks/github/${connectionId}`, {
    headers: {
      "X-Hub-Signature-256": `sha256=${createHmac("sha256", secret).update(orphanRaw).digest("hex")}`,
      "X-GitHub-Delivery": `e2e-orphan-${stamp}`,
      "X-GitHub-Event": "pull_request",
      "Content-Type": "application/json",
    },
    data: orphanRaw,
  });

  await page.reload();
  await page.getByRole("tab", { name: "Integrations" }).click();
  await expect(page.getByText("octo/repo#31")).toBeVisible();
  await expect(page.getByText("octo/repo#32")).toBeVisible();

  // Health flags the merged-without-approval change and the unlinked work.
  await page.goto(`/projects/${projectId}/health`);
  await expect(page.getByText("Unapproved implementation")).toBeVisible();
  await expect(page.getByText("Unlinked work")).toBeVisible();
  await expect(page.getByText(/1 change implemented or merged without an approval decision/)).toBeVisible();

  // Rotate then disconnect from the Integrations tab.
  await page.goto(`/projects/${projectId}`);
  await page.getByRole("tab", { name: "Integrations" }).click();
  await page.getByRole("button", { name: "Rotate secret" }).click();
  await page.getByRole("button", { name: "Rotate secret", exact: true }).click();
  const rotated = page.getByRole("dialog", { name: "Copy the webhook secret now" });
  await expect(rotated).toBeVisible();
  expect(await rotated.locator('input[aria-label="Copy the webhook secret now"]').inputValue()).not.toBe(secret);
  await rotated.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Disconnect" }).click();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByRole("button", { name: "Connect GitHub" })).toBeVisible();

  await axeClean(page);
});

import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PASSWORD = "password1234";

async function axeClean(page: Parameters<Parameters<typeof test>[1]>[0]["page"]): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, JSON.stringify(serious.map((x) => ({ id: x.id, nodes: x.nodes.length })), null, 2)).toEqual([]);
}

test("approval policies: thresholds, multi-approver votes, and turn order", async ({ page }) => {
  const stamp = Date.now();
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Policy Owner");
  await page.getByLabel("Email").fill(`policy-${stamp}@test.dev`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Organization name").fill("Policy Org");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  const me = await page.request.get("/api/v1/auth/me");
  const meJson = (await me.json()) as { user: { id: string }; organizations: Array<{ id: string }> };
  const orgId = meJson.organizations[0]?.id as string;
  const selfId = meJson.user.id;

  const clientRes = await page.request.post("/api/v1/clients", { data: { organizationId: orgId, name: "Globex" } });
  const clientId = ((await clientRes.json()) as { id: string }).id;
  const projectRes = await page.request.post("/api/v1/projects", {
    data: { organizationId: orgId, clientId, name: "Policy project", currency: "USD" },
  });
  const projectId = ((await projectRes.json()) as { id: string }).id;

  // Thresholds through the Policy tab: small packages ANY, everything else ALL.
  await page.goto(`/projects/${projectId}`);
  await page.getByRole("tab", { name: "Policy" }).click();
  await expect(page.getByText(/Amount thresholds pick the decision rule/)).toBeVisible();
  await page.getByRole("button", { name: "Add rule" }).click();
  await page.getByRole("button", { name: "Up to" }).click();
  await page.getByLabel("Up to").fill("5000.00");
  await page.getByRole("button", { name: "Add rule" }).click();
  await page.locator("#policy-mode-1").selectOption("ALL");
  await page.getByRole("button", { name: "Save thresholds" }).click();
  await expect(page.getByText("Thresholds saved.")).toBeVisible();
  await axeClean(page);

  const mkSendable = async (title: string, priceMinor: number): Promise<string> => {
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
    await page.request.post(`/api/v1/change-requests/${body.id}/impact`, {
      data: { effortDays: 2, priceMinor, timelineDays: 3, confidence: "HIGH" },
    });
    return body.id;
  };

  // A $12k package resolves to ALL automatically; both approvers vote in the UI.
  const changeId = await mkSendable("Big rebuild", 1200000);
  const send = await page.request.post(`/api/v1/change-requests/${changeId}/approval-requests`, {
    data: {
      approverUserIds: [selfId],
      approverEmails: [`second-${stamp}@client.test`],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    },
  });
  expect(send.status()).toBe(201);
  const sendBody = (await send.json()) as { approval: { policy: { mode: string } }; reviewUrls: string[] };
  expect(sendBody.approval.policy.mode).toBe("ALL");
  const [firstUrl, secondUrl] = sendBody.reviewUrls.map((u) => u.replace(/^https?:\/\/[^/]+/, ""));

  await page.goto(firstUrl as string);
  await expect(page.getByRole("heading", { name: "Approvers" })).toBeVisible();
  await expect(page.getByText("Every approver must approve")).toBeVisible();
  await expect(page.getByText("Waiting", { exact: true }).first()).toBeVisible();
  await axeClean(page);
  await page.getByRole("radio", { name: "Approve" }).check();
  await page.getByRole("checkbox", { name: /I confirm this decision/ }).check();
  await page.getByRole("button", { name: "Record decision" }).click();
  await expect(page.getByText(/You decided.*Approved/)).toBeVisible();
  await expect(page.getByText("Waiting on the other approvers.")).toBeVisible();

  await page.goto(secondUrl as string);
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
  await page.getByRole("radio", { name: "Approve" }).check();
  await page.getByRole("checkbox", { name: /I confirm this decision/ }).check();
  await page.getByRole("button", { name: "Record decision" }).click();
  await expect(page.getByText("Decided:")).toBeVisible();

  const decided = await page.request.get(`/api/v1/change-requests/${changeId}`);
  expect(((await decided.json()) as { status: string }).status).toBe("APPROVED");

  // SEQUENTIAL via per-send override: the second form unlocks only in turn.
  const seqId = await mkSendable("Staged rollout", 1200000);
  const seqSend = await page.request.post(`/api/v1/change-requests/${seqId}/approval-requests`, {
    data: {
      approverUserIds: [selfId],
      approverEmails: [`third-${stamp}@client.test`],
      policyMode: "SEQUENTIAL",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    },
  });
  expect(seqSend.status()).toBe(201);
  const [seqFirst, seqSecond] = (((await seqSend.json()) as { reviewUrls: string[] }).reviewUrls as string[]).map((u) =>
    u.replace(/^https?:\/\/[^/]+/, ""),
  );
  await page.goto(seqSecond as string);
  await expect(page.getByText(/Approvers decide in order/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Record decision" })).toHaveCount(0);
  await page.goto(seqFirst as string);
  await page.getByRole("radio", { name: "Approve" }).check();
  await page.getByRole("checkbox", { name: /I confirm this decision/ }).check();
  await page.getByRole("button", { name: "Record decision" }).click();
  await expect(page.getByText("Waiting on the other approvers.")).toBeVisible();
  await page.goto(seqSecond as string);
  await expect(page.getByRole("button", { name: "Record decision" })).toBeVisible();
});

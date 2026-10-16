import { expect, test } from "@playwright/test";

const PASSWORD = "password1234";

/**
 * Regression: the inbox badge counts pending decisions plus unread
 * notifications, and every counted item is visible on the inbox page
 * (previously the badge counted notifications while the page only listed
 * approvals, so a numbered badge could open an empty page).
 */
test("inbox badge matches visible decisions and notifications", async ({ page, playwright }) => {
  const stamp = Date.now();
  const ownerEmail = `inbox-owner-${stamp}@test.dev`;
  const memberEmail = `inbox-member-${stamp}@test.dev`;

  // Register as agency owner.
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Inbox Owner");
  await page.getByLabel("Email").fill(ownerEmail);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Organization name").fill("Inbox Org");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  // Fixture setup through the API: client + project.
  const me = await page.request.get("/api/v1/auth/me");
  expect(me.ok()).toBeTruthy();
  const orgId = ((await me.json()) as { organizations: Array<{ id: string }> }).organizations[0]?.id as string;
  const clientRes = await page.request.post("/api/v1/clients", { data: { organizationId: orgId, name: "Globex" } });
  expect(clientRes.ok()).toBeTruthy();
  const clientId = ((await clientRes.json()) as { id: string }).id;
  const projectRes = await page.request.post("/api/v1/projects", {
    data: { organizationId: orgId, clientId, name: "Website relaunch" },
  });
  expect(projectRes.ok()).toBeTruthy();
  const projectId = ((await projectRes.json()) as { id: string }).id;

  // Second user joins as project lead and publishes the baseline, which
  // notifies the owner (one unread notification, zero pending decisions).
  const memberApi = await playwright.request.newContext({ baseURL: "http://localhost:5100" });
  const registerB = await memberApi.post("/api/v1/auth/register", {
    data: { name: "Ivy Member", email: memberEmail, password: PASSWORD, organizationName: "Temp" },
  });
  expect(registerB.ok()).toBeTruthy();
  const invite = await page.request.post(`/api/v1/organizations/${orgId}/invitations`, {
    data: { email: memberEmail, role: "MEMBER", projectId, projectRole: "LEAD" },
  });
  expect(invite.ok()).toBeTruthy();
  const token = ((await invite.json()) as { token: string }).token;
  const accept = await memberApi.post(`/api/v1/auth/invitations/${token}/accept`, { data: {} });
  expect(accept.ok()).toBeTruthy();

  const draft = await memberApi.post(`/api/v1/projects/${projectId}/scope-versions/draft`, { data: { title: "Baseline" } });
  expect(draft.ok()).toBeTruthy();
  const draftId = ((await draft.json()) as { id: string }).id;
  const req = await memberApi.post(`/api/v1/projects/${projectId}/requirements`, {
    data: { draftVersionId: draftId, title: "Homepage", description: "Homepage description", acceptanceCriteria: ["Works"] },
  });
  expect(req.ok()).toBeTruthy();
  const loaded = await memberApi.get(`/api/v1/scope-versions/${draftId}`);
  expect(loaded.ok()).toBeTruthy();
  const publish = await memberApi.post(`/api/v1/scope-versions/${draftId}/publish`, {
    data: { expectedVersion: ((await loaded.json()) as { version: number }).version },
  });
  expect(publish.ok()).toBeTruthy();

  // The badge shows 1 and the inbox page reveals the matching notification.
  await page.reload();
  const headerInbox = page.locator("header").getByRole("link", { name: /^Inbox 1$/ });
  await expect(headerInbox).toBeVisible();
  await page.goto("/inbox");
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await expect(page.getByText("Nothing needs your decision")).toBeVisible();
  await page.getByRole("tab", { name: /Notifications/ }).click();
  await expect(page.getByText("Scope v1 published")).toBeVisible();

  // Marking it read clears the badge: nothing counted, nothing hidden.
  await page.getByRole("button", { name: "Mark read" }).click();
  await expect(headerInbox).toHaveCount(0);
  await expect(page.locator("header").getByRole("link", { name: /^Inbox$/ })).toBeVisible();
});

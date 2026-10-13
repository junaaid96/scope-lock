import { expect, test } from "@playwright/test";

const PASSWORD = "password1234";

test("guards protected routes and validates login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Email").fill("nobody@test.dev");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("alert")).toContainText("Invalid email or password");
});

test("full pilot loop: register → baseline → change → approval → decision", async ({ page, playwright }) => {
  const stamp = Date.now();
  const ownerEmail = `owner-${stamp}@test.dev`;

  // Register as agency owner.
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Olivia Owner");
  await page.getByLabel("Email").fill(ownerEmail);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Organization name").fill("Acme Studio");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  // API fast-path for fixture setup that the UI also supports (client + project).
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

  // Publish a baseline through the UI.
  await page.goto(`/projects/${projectId}/scope`);
  await page.getByRole("button", { name: "New draft" }).click();
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.getByRole("button", { name: "Add requirement" }).click();
  await page.getByLabel("Title").fill("Marketing homepage");
  await page.getByLabel("Description").fill("Responsive homepage with hero and contact sections.");
  await page.getByRole("button", { name: "Add to draft" }).click();
  await expect(page.getByText("REQ-001 · Marketing homepage")).toBeVisible();
  await page.getByRole("button", { name: "Publish baseline" }).click();
  await expect(page.getByText("PUBLISHED").first()).toBeVisible();

  // Submit a change request through the UI.
  await page.goto(`/projects/${projectId}`);
  await page.getByRole("button", { name: "New change request" }).click();
  await page.getByLabel("Title").fill("Add testimonials");
  await page.getByLabel("Description").fill("Add a testimonials carousel to the homepage.");
  await page.getByRole("button", { name: "Create as draft" }).click();
  await expect(page.getByText("CHG-001: Add testimonials")).toBeVisible();
  await page.getByText("CHG-001: Add testimonials").click();
  await expect(page.getByRole("heading", { name: /CHG-001/ })).toBeVisible();

  // Submit → estimate → impact → send, via API for speed, then decide in the UI.
  const changes = await page.request.get(`/api/v1/projects/${projectId}/change-requests`);
  const change = (((await changes.json()) as { data: Array<{ id: string; version: number }> }).data)[0] as { id: string; version: number };
  let v = change.version;
  for (const status of ["SUBMITTED", "TRIAGING", "ESTIMATING"]) {
    const r = await page.request.patch(`/api/v1/change-requests/${change.id}`, { data: { expectedVersion: v, status } });
    expect(r.ok()).toBeTruthy();
    v = (((await r.json()) as { version: number }).version) as number;
  }
  const impact = await page.request.post(`/api/v1/change-requests/${change.id}/impact`, {
    data: { effortDays: 2, priceMinor: 120000, confidence: "HIGH" },
  });
  expect(impact.ok()).toBeTruthy();

  // Invite a client approver and send the package to them.
  const invite = await page.request.post(`/api/v1/organizations/${orgId}/invitations`, {
    data: { email: `carl-${stamp}@test.dev`, role: "CLIENT" },
  });
  expect(invite.ok()).toBeTruthy();
  const { token: inviteToken } = (await invite.json()) as { token: string };
  // Accept in a fresh (unauthenticated) API context — the owner session must not leak in.
  const fresh = await playwright.request.newContext({ baseURL: new URL(page.url()).origin });
  const acceptCtx = await fresh.post(`/api/v1/auth/invitations/${inviteToken}/accept`, {
    data: { name: "Carl Client", password: PASSWORD },
  });
  expect(acceptCtx.ok()).toBeTruthy();
  const clientUserId = ((await acceptCtx.json()) as { user: { id: string } }).user.id;
  const addMember = await page.request.post(`/api/v1/projects/${projectId}/members`, {
    data: { userId: clientUserId, role: "CLIENT_APPROVER" },
  });
  expect(addMember.ok()).toBeTruthy();
  const send = await page.request.post(`/api/v1/change-requests/${change.id}/approval-requests`, {
    data: { approverUserIds: [clientUserId], expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
  });
  expect(send.ok()).toBeTruthy();
  const reviewUrl = (((await send.json()) as { reviewUrls: string[] }).reviewUrls)[0] as string;
  const reviewToken = reviewUrl.split("/review/")[1] as string;

  // Decide as the client on the public review page (fresh browser state).
  await page.context().clearCookies();
  await page.goto(`/review/${reviewToken}`);
  await expect(page.getByRole("heading", { name: /Add testimonials/ }).first()).toBeVisible();
  await expect(page.getByText("USD 1200.00")).toBeVisible();
  await page.getByLabel(/I confirm this decision/).check();
  await page.getByRole("button", { name: "Record decision" }).click();
  await expect(page.getByText("Decided:")).toBeVisible();
  await expect(page.getByText("APPROVED").first()).toBeVisible();
});

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const SHOTS = join(import.meta.dirname, "..", "..", "..", "docs", "screenshots");

interface ProjectListItem {
  id: string;
  name: string;
}
interface ChangeListItem {
  id: string;
  number: string;
}

test("capture docs screenshots from the portfolio seed", async ({ page, browser }) => {
  // 1. Login with one-click demo accounts.
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Agency owner" })).toBeVisible();
  await page.screenshot({ path: join(SHOTS, "login.png") });

  // 2. Agency dashboard over the 16-project portfolio.
  await page.getByRole("button", { name: "Agency owner" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await page.screenshot({ path: join(SHOTS, "dashboard.png") });

  // Resolve the Green Biotech ERP showcase project and its CHG-001 via the API.
  const me = await page.request.get("/api/v1/auth/me");
  expect(me.ok()).toBeTruthy();
  const orgId = ((await me.json()) as { organizations: Array<{ id: string }> }).organizations[0]?.id as string;
  const projectsRes = await page.request.get(`/api/v1/projects?organizationId=${orgId}&limit=100`);
  expect(projectsRes.ok()).toBeTruthy();
  const projects = ((await projectsRes.json()) as { data: ProjectListItem[] }).data;
  const erp = projects.find((p) => /erp/i.test(p.name)) ?? projects[0];
  if (!erp) throw new Error("portfolio seed produced no projects");
  const changesRes = await page.request.get(`/api/v1/projects/${erp.id}/change-requests?limit=100`);
  expect(changesRes.ok()).toBeTruthy();
  const changes = ((await changesRes.json()) as { data: ChangeListItem[] }).data;
  const chg = changes.find((c) => c.number === "CHG-001") ?? changes[0];
  if (!chg) throw new Error("portfolio seed produced no changes for the showcase project");

  // 3. Project board.
  await page.goto(`/projects/${erp.id}`);
  await page.getByRole("tab", { name: "Board" }).click();
  await expect(page.getByRole("tab", { name: "Board" })).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: join(SHOTS, "board.png") });

  // 4. Scope ledger.
  await page.goto(`/projects/${erp.id}/scope`);
  await expect(page.getByRole("heading", { name: "Scope ledger" })).toBeVisible();
  await page.screenshot({ path: join(SHOTS, "scope.png") });

  // 5. Change detail with its audit trail.
  await page.goto(`/projects/${erp.id}/changes/${chg.id}`);
  await expect(page.getByRole("heading", { name: new RegExp(chg.number) })).toBeVisible();
  await page.screenshot({ path: join(SHOTS, "change.png") });

  // 6. Client-side review link (logged out, fresh context).
  const { reviewPath } = JSON.parse(readFileSync(join(import.meta.dirname, "..", "screenshots-data", "review-link.json"), "utf8")) as {
    reviewPath: string | null;
  };
  if (reviewPath) {
    const client = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const review = await client.newPage();
    await review.goto(reviewPath);
    await expect(review.getByRole("heading").first()).toBeVisible();
    await expect(review.getByRole("radiogroup", { name: "Decision" })).toBeVisible();
    await review.screenshot({ path: join(SHOTS, "review.png") });
    await client.close();
  }

  // 7. Client inbox with the pending decision (fresh context, Tanvir).
  const tanvir = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const inbox = await tanvir.newPage();
  await inbox.goto("/login");
  await inbox.getByRole("button", { name: "Haat" }).click();
  await expect(inbox.getByRole("heading", { name: "Projects" })).toBeVisible();
  await inbox.goto("/inbox");
  await expect(inbox.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await inbox.screenshot({ path: join(SHOTS, "inbox.png") });
  await tanvir.close();
});

import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

// Output dir is overridable so the same run can also produce hi-dpi marketing shots.
const SHOTS = process.env.SHOT_DIR ?? join(import.meta.dirname, "..", "..", "..", "docs", "screenshots");
mkdirSync(SHOTS, { recursive: true });

interface ProjectListItem {
  id: string;
  name: string;
}
interface ChangeListItem {
  id: string;
  number: string;
  title: string;
}

async function snap(page: Page, name: string): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

test("capture docs screenshots for every major screen and role", async ({ page, browser }) => {
  test.setTimeout(240_000);

  // 1. Public landing page + sign-in.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/welcome");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await snap(page, "01-landing");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Agency owner" })).toBeVisible();
  await snap(page, "02-login");

  // 2. Agency owner: dashboard over the 16-project portfolio.
  await page.getByRole("button", { name: "Agency owner" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await expect(page.getByText("Contract value")).toBeVisible();
  await snap(page, "03-dashboard");

  const me = await page.request.get("/api/v1/auth/me");
  expect(me.ok()).toBeTruthy();
  const orgId = ((await me.json()) as { organizations: Array<{ id: string }> }).organizations[0]?.id as string;
  const projectsRes = await page.request.get(`/api/v1/projects?organizationId=${orgId}&limit=100`);
  const projects = ((await projectsRes.json()) as { data: ProjectListItem[] }).data;
  const haat = projects.find((p) => /haat/i.test(p.name)) ?? projects[0];
  const erp = projects.find((p) => /green biotech erp/i.test(p.name)) ?? projects[0];
  if (!haat || !erp) throw new Error("portfolio seed produced no projects");
  const changesOf = async (projectId: string): Promise<ChangeListItem[]> => {
    const res = await page.request.get(`/api/v1/projects/${projectId}/change-requests?limit=100`);
    return ((await res.json()) as { data: ChangeListItem[] }).data;
  };
  const haatChanges = await changesOf(haat.id);
  const erpChanges = await changesOf(erp.id);
  const teamBuy = haatChanges.find((c) => /team buy/i.test(c.title)) ?? haatChanges[0];
  const erpChg = erpChanges.find((c) => c.number === "CHG-001") ?? erpChanges[0];
  if (!teamBuy || !erpChg) throw new Error("portfolio seed produced no changes");

  // One public intake link so the Intake tab shows a live link row.
  const intakeRes = await page.request.post(`/api/v1/projects/${haat.id}/intake-links`, { data: { name: "Front desk", expiresAt: null } });
  const intakeUrl = intakeRes.ok() ? ((await intakeRes.json()) as { url: string }).url : null;

  // 3. Project workspace tabs.
  await page.goto(`/projects/${haat.id}`);
  await expect(page.getByRole("tab", { name: /Changes/ })).toBeVisible();
  await snap(page, "04-project-changes");
  for (const [tab, file] of [
    ["Board", "05-board"],
    ["Contract", "06-contract"],
    ["Allowance", "07-allowance"],
    ["Intake", "09-intake"],
    ["Policy", "10-approval-policy"],
    ["Integrations", "11-integrations"],
    ["Members", "12-members"],
  ] as const) {
    await page.getByRole("tab", { name: tab }).click();
    await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
    await snap(page, file);
  }

  await page.goto(`/projects/${erp.id}`);
  await page.getByRole("tab", { name: "Actuals" }).click();
  await expect(page.getByRole("tab", { name: "Actuals" })).toHaveAttribute("aria-selected", "true");
  await snap(page, "08-estimate-vs-actual");

  // 4. Scope ledger, version compare, timeline, activity (audit trail), health.
  await page.goto(`/projects/${erp.id}/scope`);
  await expect(page.getByRole("heading", { name: "Scope ledger" })).toBeVisible();
  await snap(page, "13-scope-ledger");
  const compare = page.getByLabel("Compare against");
  if (await compare.count()) {
    await compare.selectOption({ index: 1 }).catch(() => undefined);
    await page.getByRole("heading", { name: "Agreement diff" }).scrollIntoViewIfNeeded().catch(() => undefined);
    await snap(page, "14-scope-compare");
  }
  await page.goto(`/projects/${erp.id}/timeline`);
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
  await snap(page, "15-timeline");
  await page.goto(`/projects/${haat.id}/activity`);
  await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
  await snap(page, "16-activity-audit");
  await page.goto(`/projects/${haat.id}/health`);
  await expect(page.getByRole("heading", { name: "Scope health" })).toBeVisible();
  await snap(page, "17-health");

  // 5. Change request detail (impact, decision, audit trail) + decided change.
  await page.goto(`/projects/${haat.id}/changes/${teamBuy.id}`);
  await expect(page.getByRole("heading", { name: new RegExp(teamBuy.number) })).toBeVisible();
  await snap(page, "18-change-detail");
  await page.goto(`/projects/${erp.id}/changes/${erpChg.id}`);
  await expect(page.getByRole("heading", { name: new RegExp(erpChg.number) })).toBeVisible();
  await snap(page, "19-change-decided");
  const pdfHref = (await page.getByRole("link", { name: "Change order (PDF)" }).first().getAttribute("href").catch(() => null)) ?? "";
  const approvalId = pdfHref.match(/apr_[A-Za-z0-9]+/)?.[0] ?? null;

  // 6. Command palette, workspace settings, agency inbox, intake form link.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  await snap(page, "20-command-palette");
  await page.keyboard.press("Escape");
  await page.goto(`/orgs/${orgId}/settings`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await snap(page, "21-workspace-settings");
  await page.goto("/inbox");
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await snap(page, "22-inbox");

  // 7. Dark mode (theme toggle persisted via localStorage) + Bangla.
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("sl-theme", "dark");
  });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await snap(page, "23-dashboard-dark");
  await page.goto(`/projects/${haat.id}/changes/${teamBuy.id}`);
  await expect(page.getByRole("heading", { name: new RegExp(teamBuy.number) })).toBeVisible();
  await snap(page, "24-change-dark");
  await page.evaluate(() => {
    localStorage.setItem("sl-theme", "light");
  });
  await page.request.patch("/api/v1/auth/me/preferences", { data: { locale: "bn" } });
  await page.goto(`/projects/${haat.id}/health`);
  await page.waitForLoadState("networkidle");
  await snap(page, "25-health-bangla");
  await page.request.patch("/api/v1/auth/me/preferences", { data: { locale: "en" } });

  // 8. Client side (logged out): login-free review link, intake form, public certificate.
  const { reviewPath } = JSON.parse(readFileSync(join(import.meta.dirname, "..", "screenshots-data", "review-link.json"), "utf8")) as {
    reviewPath: string | null;
  };
  const anon = await browser.newContext({ viewport: { width: 1440, height: 1250 }, deviceScaleFactor: Number(process.env.SHOT_SCALE ?? 1) });
  const pub = await anon.newPage();
  if (reviewPath) {
    await pub.goto(reviewPath);
    await expect(pub.getByRole("radiogroup", { name: "Decision" })).toBeVisible();
    await snap(pub, "26-client-review");
  }
  if (intakeUrl) {
    await pub.goto(intakeUrl.startsWith("http") ? new URL(intakeUrl).pathname : intakeUrl);
    await expect(pub.getByRole("heading").first()).toBeVisible();
    await snap(pub, "27-client-intake-form");
  }
  if (approvalId) {
    await pub.goto(`/verify/${approvalId}`);
    await expect(pub.getByText("Checksum match")).toBeVisible();
    await snap(pub, "28-decision-certificate");
  }
  await anon.close();

  // 9. Client approver (Haat): inbox on desktop, then mobile review + inbox + menu.
  const tanvir = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: Number(process.env.SHOT_SCALE ?? 1) });
  const inbox = await tanvir.newPage();
  await inbox.goto("/login");
  await inbox.getByRole("button", { name: "Haat" }).click();
  await expect(inbox.getByRole("heading", { name: "Projects" })).toBeVisible();
  await inbox.goto("/inbox");
  await expect(inbox.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await snap(inbox, "29-client-inbox");
  await tanvir.close();

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: Number(process.env.SHOT_SCALE ?? 1), isMobile: true, hasTouch: true });
  const m = await phone.newPage();
  if (reviewPath) {
    await m.goto(reviewPath);
    await expect(m.getByRole("radiogroup", { name: "Decision" })).toBeVisible();
    await snap(m, "30-mobile-review");
  }
  await m.goto("/login");
  await m.getByRole("button", { name: "Haat" }).click();
  await expect(m.getByRole("heading", { name: "Projects" })).toBeVisible();
  await m.goto("/inbox");
  await expect(m.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await snap(m, "31-mobile-inbox");
  await m.getByRole("button", { name: "Open navigation menu" }).click();
  await expect(m.locator("#mobile-nav")).toBeVisible();
  await snap(m, "32-mobile-menu");
  await phone.close();
});

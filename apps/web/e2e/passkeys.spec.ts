import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PASSWORD = "password1234";

async function axeClean(page: Parameters<Parameters<typeof test>[1]>[0]["page"]): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious, JSON.stringify(serious.map((x) => ({ id: x.id, nodes: x.nodes.length })), null, 2)).toEqual([]);
}

test("passkeys: register with a virtual authenticator, then log in with it", async ({ page }) => {
  const stamp = Date.now();
  const email = `passkey-${stamp}@test.dev`;
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Passkey Owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByLabel("Organization name").fill("Passkey Org");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  const me = await page.request.get("/api/v1/auth/me");
  const meJson = (await me.json()) as { organizations: Array<{ id: string }> };
  const orgId = meJson.organizations[0]?.id as string;

  // OAuth providers are not configured in e2e: no buttons, methods say so.
  const methods = await page.request.get("/api/v1/auth/methods");
  expect(await methods.json()).toEqual({ password: true, google: false, github: false, passkey: true });

  // Virtual authenticator: platform key, resident, user-verifying.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await page.goto(`/orgs/${orgId}/settings`);
  await page.getByLabel("New passkey name").fill("E2E key");
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await expect(page.getByText("E2E key")).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue with Google" })).toHaveCount(0);
  await page.getByLabel("Account address for passkey sign-in (optional)").fill(email);
  await page.getByRole("button", { name: "Passkey", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  await axeClean(page);
});

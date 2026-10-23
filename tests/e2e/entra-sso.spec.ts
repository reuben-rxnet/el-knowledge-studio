import { expect, test, type Page } from "@playwright/test";

/** Signs in through the test identity provider's login and consent pages. */
async function ssoSignIn(page: Page, login: string) {
  await page.goto("/sign-in");
  await expect(page.getByText("Demo authentication.")).toHaveCount(0);
  await page.getByTestId("entra-signin").click();
  await page.locator("input[name=login]").fill(login);
  await page.locator("input[name=password]").fill("any");
  await page.locator("button[type=submit]").click();
  const consent = page.getByRole("button", { name: /continue/i });
  if (await consent.isVisible().catch(() => false)) await consent.click();
}

test("A user with an app role signs in with company SSO and gets that role", async ({ page }) => {
  await ssoSignIn(page, "amara");
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Current workspace" })).toHaveValue(/.+/);
  await expect(page.getByTestId("persona-switcher")).toHaveCount(0); // no demo persona switcher with SSO
});

test("A new employee is provisioned on first sign-in with only the assigned role", async ({ page }) => {
  await ssoSignIn(page, "newstarter");
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create" })).toHaveCount(0); // consumer: can't create
  await page.goto("/audit");
  await expect(page.getByText("You don't have access to the audit history")).toBeVisible();
});

test("No role assignment means no access", async ({ page }) => {
  await ssoSignIn(page, "norole");
  await expect(page).toHaveURL(/error=no-access/);
  await expect(page.getByText(/has no EL Knowledge Studio role yet/)).toBeVisible();
});

test("An account from another tenant is refused", async ({ page }) => {
  await ssoSignIn(page, "foreign");
  await expect(page).toHaveURL(/error=wrong-tenant/);
});

test("A forged session cookie is rejected, and sign-out ends the session", async ({ page, context }) => {
  await context.addCookies([{ name: "elks_session", value: "cmfakeuserid", url: "http://localhost:3012" }]);
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in/);

  await ssoSignIn(page, "amara");
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/, { timeout: 30_000 });
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in/);
});

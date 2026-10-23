import { expect, type Page } from "@playwright/test";

export const PERSONA = {
  creator: "amara.mensah@demo.el-knowledge.test",
  reviewer: "pierre.laurent@demo.el-knowledge.test",
  approver: "chiara.bellini@demo.el-knowledge.test",
  publisher: "sofia.ramirez@demo.el-knowledge.test",
  translator: "kenji.watanabe@demo.el-knowledge.test",
  wsadmin: "daniel.okafor@demo.el-knowledge.test",
  consumer: "leo.fischer@demo.el-knowledge.test",
} as const;

export async function signIn(page: Page, who: keyof typeof PERSONA) {
  await page.goto("/sign-in");
  await page.locator(`form:has(input[value="${PERSONA[who]}"]) button`).click();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
}

/** Uses the in-app demo persona switcher, which keeps the current page. */
export async function switchPersona(page: Page, who: keyof typeof PERSONA) {
  const posted = page.waitForResponse((r) => r.request().method() === "POST");
  await page.getByTestId("persona-switcher").selectOption(PERSONA[who]);
  await posted;
  await page.waitForLoadState("networkidle");
  await page.reload();
  await expect(page.getByTestId("persona-switcher")).toHaveValue(PERSONA[who]);
}

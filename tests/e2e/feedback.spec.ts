import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signIn, switchPersona } from "./helpers";

test("Pilot feedback — a store associate sends it, the workspace administrator triages it", async ({ page }) => {
  const message = `The step screenshots are too small on my tablet (${Date.now()}).`;
  await signIn(page, "consumer");
  await page.goto("/feedback");
  await page.getByTestId("fb-idea").check();
  await page.getByLabel("Your feedback *").fill(message);
  await page.getByLabel("Where in the app? (optional)").fill("Guide tab");
  await page.getByTestId("fb-send").click();
  await expect(page.getByText(/Your feedback was sent to the Retail Operations · Europe administrators/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your feedback" })).toBeVisible();
  await expect(page.getByText(message)).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await switchPersona(page, "wsadmin");
  await page.goto("/feedback");
  await expect(page.getByRole("heading", { name: "Feedback in Retail Operations · Europe" })).toBeVisible();
  const item = page.getByRole("listitem").filter({ hasText: message });
  await expect(item).toContainText("Leo Fischer");
  await item.getByLabel("Status").selectOption("triaged");
  await page.reload();
  await expect(page.getByRole("listitem").filter({ hasText: message }).getByLabel("Status")).toHaveValue("triaged");
});

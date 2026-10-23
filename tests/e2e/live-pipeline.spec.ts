import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("Upload a procedure document — the live pipeline extracts it, drafts a quiz and stores translations", async ({ page }) => {
  await signIn(page, "creator");
  await page.goto("/create/upload?kind=document");
  await page.locator("#file").setInputFiles({
    name: "store-closing.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Store closing procedure\n1. Open Store Portal and select Close Day.\n2. Count the cash drawer and enter the total.\n3. Lock the safe and confirm the closing."),
  });
  await page.getByTestId("upload-continue").click();
  await page.getByRole("button", { name: "Continue" }).click(); // outputs
  await page.getByLabel("Process category *").fill("Store operations");
  await page.getByLabel("Country *").fill("Italy");
  await page.getByLabel("Intended audience *").fill("Store managers");
  await page.getByLabel("Source system").fill("Store Portal");
  await page.getByRole("button", { name: "Continue" }).click(); // context
  await page.getByRole("button", { name: "Continue" }).click(); // template
  await page.getByTestId("wizard-create").click();

  await expect(page).toHaveURL(/\/processing/);
  const projectUrl = page.url().replace(/\/processing$/, "");
  await expect(page.getByText(/characters of text extracted from store-closing\.txt/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("open-draft")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/questions drafted/)).toBeVisible();

  await page.goto(`${projectUrl}/knowledge`);
  await expect(page.getByText("Q1 ·")).toBeVisible();
  await page.goto(`${projectUrl}/translations`);
  await expect(page.getByText(/\[FR · simulated\]/).first()).toBeVisible();
});

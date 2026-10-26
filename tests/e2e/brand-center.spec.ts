import path from "node:path";
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

const MP3 = path.join(__dirname, "fixtures", "formats", "sample.mp3");

test("Brand Center — the brand template is saved and the music library takes a licensed track", async ({ page }) => {
  await signIn(page, "platform"); // Enterprise administrator: brand.manage
  await page.goto("/brand");
  const tpl = page.getByTestId("brand-template");
  await expect(tpl).toBeVisible();
  await expect(page.getByTestId("brand-intro-preview")).toBeVisible();

  // Change the accent and the intro length, save, and the values survive a reload.
  await page.getByTestId("accent-gold").click();
  await expect(page.getByTestId("accent-gold")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("brand-intro-sec").fill("4.5");
  await page.getByTestId("brand-save").click();
  await expect(page.getByTestId("brand-save")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByTestId("accent-gold")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("brand-intro-sec")).toHaveValue("4.5");

  // Out-of-range values are refused by the server, not silently stored.
  await page.getByTestId("brand-intro-sec").fill("20");
  await page.getByTestId("brand-save").click();
  await expect(tpl.getByRole("alert")).toBeVisible();

  // Put the defaults back: other specs render with the default 3 s intro.
  await page.getByTestId("accent-cyan").click();
  await page.getByTestId("brand-intro-sec").fill("3");
  await page.getByTestId("brand-save").click();
  await expect(page.getByTestId("brand-save")).toHaveText("Saved");

  // Built-in tracks are listed; an uploaded one needs a title and a licence note.
  const lib = page.getByTestId("music-library");
  await expect(page.getByTestId("music-builtin-calm")).toBeVisible();
  const title = `Pilot theme ${Date.now()}`;
  await page.getByTestId("music-file").setInputFiles(MP3);
  await page.getByTestId("music-title").fill(title);
  await expect(page.getByTestId("music-upload")).toBeDisabled();
  await page.getByTestId("music-licence").fill("Company licence, e2e test");
  await page.getByTestId("music-upload").click();
  const row = lib.getByTestId("music-uploaded").filter({ hasText: title });
  await expect(row).toBeVisible();
  await expect(row).toContainText("Company licence, e2e test");
  await expect(row).toContainText("Inês Duarte");

  page.once("dialog", (d) => void d.accept());
  await row.getByTestId("music-remove").click();
  await expect(lib.getByTestId("music-uploaded").filter({ hasText: title })).toHaveCount(0);
});

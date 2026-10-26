import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import ffmpeg from "ffmpeg-static";
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";
import { makePdf } from "./fixtures/pdf";

test.describe.configure({ mode: "serial" });
let projectUrl = "";

test("A PDF's pages become the video preview: each chapter shows its page", async ({ page }) => {
  await signIn(page, "creator");
  await page.goto("/create/upload?kind=document");
  await page.locator("#file").setInputFiles({ name: "close-day-deck.pdf", mimeType: "application/pdf", buffer: makePdf(["Open Store Portal and select Close Day", "Count the cash drawer and enter the total"]) });
  await page.getByTestId("upload-continue").click();
  await page.getByRole("button", { name: "Continue" }).click(); // outputs
  await page.getByLabel("Process category *").fill("Store operations");
  await page.getByLabel("Country *").fill("Italy");
  await page.getByLabel("Intended audience *").fill("Store managers");
  await page.getByRole("button", { name: "Continue" }).click(); // context
  await page.getByRole("button", { name: "Continue" }).click(); // template
  await page.getByTestId("wizard-create").click();
  await expect(page).toHaveURL(/\/processing/);
  projectUrl = page.url().replace(/\/processing$/, "");
  await expect(page.getByText("2 page images made for the video")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("open-draft")).toBeVisible({ timeout: 90_000 });

  await page.goto(`${projectUrl}/video`);
  await expect(page.getByText(/Each chapter shows its page from close-day-deck\.pdf/)).toBeVisible();
  const slide = page.locator(".player img.slide");
  await expect(slide).toBeVisible();
  await expect(slide).toHaveAttribute("src", /\/pages\/1$/);
  expect(await slide.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1280);
  const png = await page.request.get((await slide.getAttribute("src"))!);
  expect(png.headers()["content-type"]).toBe("image/png");
});

test("The rendered MP4 is made from the pages", async ({ page }) => {
  await signIn(page, "creator");
  test.setTimeout(240_000);
  await page.goto(`${projectUrl}/video`);
  await page.getByLabel("AI voice narration").uncheck(); // the pages are what this test checks; voice has its own test
  await page.getByTestId("render-video").click();
  await expect(page.getByText("MP4 ready")).toBeVisible({ timeout: 180_000 });
  const href = await page.getByRole("link", { name: "MP4" }).first().getAttribute("href");
  const mp4 = await page.request.get(href!);
  expect(mp4.status()).toBe(200);
  // One frame just after the 3-second title card, averaged to a single pixel: a page is white,
  // a text slide is dark blue (#0B2D5B).
  const dir = mkdtempSync(path.join(os.tmpdir(), "elks-e2e-"));
  try {
    writeFileSync(path.join(dir, "out.mp4"), await mp4.body());
    const px = execFileSync(ffmpeg as unknown as string, ["-loglevel", "error", "-ss", "4", "-i", path.join(dir, "out.mp4"), "-frames:v", "1", "-vf", "scale=1:1:flags=area", "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]);
    expect(Math.min(px[0]!, px[1]!, px[2]!)).toBeGreaterThan(200);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

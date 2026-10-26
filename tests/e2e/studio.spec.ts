import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import ffmpeg from "ffmpeg-static";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

test.describe.configure({ mode: "serial" });
const fixture = path.join(__dirname, "fixtures", "formats", "twelve-seconds.mp4");
let projectUrl = "";

/**
 * Edge sharpness of the blur box's area in one frame (mean squared difference between neighbouring
 * pixels, at 1280x720): a blur turns hard edges into gradual ones, so this drops sharply.
 */
function sharpness(file: string, atSec: number) {
  const W = 384, H = 108; // 30% x 15% of 1280x720, at 35% / 40%
  const px = execFileSync(ffmpeg as unknown as string, ["-loglevel", "error", "-ss", String(atSec), "-i", file, "-frames:v", "1", "-vf", `scale=1280:720,crop=${W}:${H}:448:288,format=gray`, "-f", "rawvideo", "pipe:1"]);
  let sum = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W - 1; x++) sum += (px[y * W + x + 1]! - px[y * W + x]!) ** 2;
  return sum / (H * (W - 1));
}
/** Length of a media file in seconds, from FFmpeg's probe output. */
function durationOf(file: string) {
  const m = spawnSync(ffmpeg as unknown as string, ["-hide_banner", "-i", file]).stderr.toString().match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}
const clips = (page: Page) => page.getByTestId("studio-clip");
const time = (page: Page) => page.getByTestId("studio-time");

test("Studio (beta) sits next to the Video tab; a recording opens as one clip", async ({ page }) => {
  await signIn(page, "creator");
  await page.goto("/create/upload");
  await page.locator("#file").setInputFiles({ name: "studio-check.mp4", mimeType: "video/mp4", buffer: readFileSync(fixture) });
  await page.getByTestId("upload-continue").click({ timeout: 60_000 });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Process category *").fill("Store operations");
  await page.getByLabel("Country *").fill("Italy");
  await page.getByLabel("Intended audience *").fill("Store managers");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByTestId("wizard-create").click();
  await expect(page).toHaveURL(/\/processing/, { timeout: 60_000 });
  projectUrl = page.url().replace(/\/processing$/, "");
  await expect(page.getByTestId("open-draft")).toBeVisible({ timeout: 120_000 });

  await page.goto(projectUrl);
  const tabs = page.getByRole("navigation", { name: "Project sections" });
  await expect(tabs.getByRole("link", { name: "Video" })).toBeVisible();
  await tabs.getByRole("link", { name: "Studio (beta)" }).click();
  await expect(page).toHaveURL(/\/studio$/);
  await expect(clips(page)).toHaveCount(1);
  await expect(time(page)).toHaveText(/0:00\.0 \/ 0:12\.0/);
});

test("Split, delete, undo and redo, speed and a blur box; everything is saved", async ({ page }) => {
  await signIn(page, "creator");
  await page.goto(`${projectUrl}/studio`);
  await expect(clips(page)).toHaveCount(1);

  // Move the playhead to 6 s by clicking the ruler (75 px per second for a 12 s recording), then split.
  const ruler = page.getByTestId("studio-ruler");
  await ruler.click({ position: { x: 6 * 75, y: 10 } });
  await expect(time(page)).toHaveText(/^0:06\.0/);
  await page.keyboard.press("s");
  await expect(clips(page)).toHaveCount(2);

  // Delete the second half: the video is now 6 s long.
  await clips(page).nth(1).click();
  await page.keyboard.press("Delete");
  await expect(clips(page)).toHaveCount(1);
  await expect(time(page)).toHaveText(/\/ 0:06\.0/);
  await page.getByTestId("studio-undo").click();
  await expect(clips(page)).toHaveCount(2);
  await page.keyboard.press("Control+Shift+Z");
  await expect(clips(page)).toHaveCount(1);

  // Speed: 2x halves it; back to normal.
  await clips(page).first().click();
  await page.getByTestId("clip-speed").selectOption("2");
  await expect(time(page)).toHaveText(/\/ 0:03\.0/);
  await page.getByTestId("clip-speed").selectOption("1");
  await expect(time(page)).toHaveText(/\/ 0:06\.0/);

  // A blur box at the start, shown on the preview.
  await page.keyboard.press("Home");
  await page.getByTestId("studio-blur").click();
  await expect(page.getByTestId("blur-inspector")).toBeVisible();
  await expect(page.getByTestId("preview-blur")).toBeVisible();

  await expect(page.getByTestId("studio-save")).toHaveText("All changes saved", { timeout: 10_000 });
  await page.reload();
  await expect(clips(page)).toHaveCount(1);
  await expect(time(page)).toHaveText(/\/ 0:06\.0/);
  await expect(page.getByTestId("preview-blur")).toBeVisible();
});

test("The Studio render is the edit: 6 seconds, blurred where the box is, and the Video tab doesn't list it", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "creator");
  await page.goto(`${projectUrl}/studio`);
  await page.getByTestId("studio-render").click();
  await expect(page.getByRole("link", { name: "MP4" })).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText("v1 · Rendered in Studio")).toBeVisible();
  const href = await page.getByRole("link", { name: "MP4" }).first().getAttribute("href");
  const mp4 = await page.request.get(href!);
  expect(mp4.status()).toBe(200);

  const dir = mkdtempSync(path.join(os.tmpdir(), "elks-studio-e2e-"));
  try {
    const out = path.join(dir, "studio.mp4");
    writeFileSync(out, await mp4.body());
    const duration = durationOf(out);
    expect(duration).toBeGreaterThan(5.5);
    expect(duration).toBeLessThan(6.6);
    // The blur box covers 35-65% across and 40-55% down for the first 5 s: that area is smooth in the
    // render, while the same area of the original recording is the busy test pattern.
    expect(sharpness(out, 1)).toBeLessThan(sharpness(fixture, 1) * 0.25);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // The Video tab is unchanged: its render list doesn't include the Studio render.
  await page.goto(`${projectUrl}/video`);
  await expect(page.getByRole("heading", { name: "Rendered video" })).toBeVisible();
  await expect(page.getByText("Rendered in Studio")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "MP4" })).toHaveCount(0);
});

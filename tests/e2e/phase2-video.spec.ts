import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import ffmpeg from "ffmpeg-static";
import { signIn } from "./helpers";

test.describe.configure({ mode: "serial" });
let projectUrl = "";

test("A recorded video plays from storage, and screenshots are captured from it", async ({ page }) => {
  // A 6-second test recording (test pattern + tone), made with the bundled FFmpeg.
  const dir = path.join(process.cwd(), "test-results"); mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "e2e-recording.webm");
  execFileSync(ffmpeg as unknown as string, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=640x360:d=6:r=15", "-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-c:v", "libvpx", "-b:v", "400k", "-c:a", "libopus", "-shortest", file]);

  await signIn(page, "creator");
  await page.goto("/create/upload?kind=video");
  await page.locator("#file").setInputFiles({ name: "store-closing-demo.webm", mimeType: "video/webm", buffer: readFileSync(file) });
  await page.getByTestId("upload-continue").click({ timeout: 60_000 });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Description and process notes").fill("1. Open Store Portal. 2. Count the cash drawer twice. 3. Lock the safe.");
  await page.getByLabel("Process category *").fill("Store operations");
  await page.getByLabel("Country *").fill("Italy");
  await page.getByLabel("Intended audience *").fill("Store managers");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByTestId("wizard-create").click();
  await expect(page).toHaveURL(/\/processing/);
  projectUrl = page.url().replace(/\/processing$/, "");
  await expect(page.getByTestId("open-draft")).toBeVisible({ timeout: 90_000 });

  // The real recording streams with Range support.
  await page.goto(`${projectUrl}/video`);
  await expect(page.locator("video[src$='/media']")).toBeVisible();
  const api = projectUrl.replace(/.*\/projects\//, "/api/projects/");
  const ranged = await page.request.get(`${api}/media`, { headers: { range: "bytes=0-99" } });
  expect(ranged.status()).toBe(206);
  expect(ranged.headers()["content-range"]).toMatch(/^bytes 0-99\/\d+$/);

  // Screenshots are captured in the browser from the recording.
  await page.goto(`${projectUrl}/guide`);
  await page.getByRole("button", { name: "Capture screenshots from recording" }).click();
  await expect(page.getByText(/screenshots captured from the recording/)).toBeVisible({ timeout: 60_000 });
  await expect(page.locator("img[src*='/screenshot']").first()).toBeVisible();
});

test("A project renders to a downloadable MP4 with FFmpeg", async ({ page }) => {
  await signIn(page, "creator");
  await page.goto(`${projectUrl}/video`);
  await page.getByTestId("render-video").click();
  await expect(page.getByText("MP4 ready")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("rendered-video")).toBeVisible();
  const href = await page.getByRole("link", { name: "MP4" }).first().getAttribute("href");
  const mp4 = await page.request.get(href!);
  expect(mp4.status()).toBe(200);
  expect(mp4.headers()["content-type"]).toBe("video/mp4");
  expect(mp4.headers()["content-disposition"]).toContain(".mp4");
});

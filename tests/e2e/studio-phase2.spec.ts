import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import ffmpeg from "ffmpeg-static";
import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * Studio phase 2 on a fake e-mail screen (all data invented): "From: jane.doe@example.com",
 * "Cc: Amara Mensah" (a member of the workspace), "Phone: +1 555 0100 2233".
 * The e2e server has speech recognition switched off, so the word timings that "Prepare text editing"
 * would produce with Whisper are written straight into the test database.
 */
test.describe.configure({ mode: "serial" });
const fixture = path.join(__dirname, "fixtures", "formats", "pii-screen.mp4");
const FF = ffmpeg as unknown as string;
let projectUrl = "";

const time = (page: Page) => page.getByTestId("studio-time");
const totalOf = async (page: Page) => { const m = (await time(page).innerText()).match(/\/ (\d+):(\d+\.\d)/); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
function durationOf(file: string) {
  const m = spawnSync(FF, ["-hide_banner", "-i", file]).stderr.toString().match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}
/** Gray pixels of one area of one frame, at 1280x720. */
function area(file: string, t: number, x: number, y: number, w: number, h: number) {
  return execFileSync(FF, ["-loglevel", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", `scale=1280:720,crop=${w}:${h}:${x}:${y},format=gray`, "-f", "rawvideo", "pipe:1"]);
}
const sharpness = (px: Buffer, w: number) => { let s = 0, n = 0; for (let i = 0; i + 1 < px.length; i++) if ((i + 1) % w) { s += (px[i + 1]! - px[i]!) ** 2; n++; } return s / n; };
const mean = (px: Buffer) => px.reduce((a, b) => a + b, 0) / px.length;

test("Edit by text: cut a word, undo, then tidy up filler words and pauses", async ({ page }) => {
  await signIn(page, "creator");
  await page.goto("/create/upload");
  await page.locator("#file").setInputFiles({ name: "printer-queue.mp4", mimeType: "video/mp4", buffer: readFileSync(fixture) });
  await page.getByTestId("upload-continue").click({ timeout: 60_000 });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Process category *").fill("IT support");
  await page.getByLabel("Country *").fill("Italy");
  await page.getByLabel("Intended audience *").fill("Store managers");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByTestId("wizard-create").click();
  await expect(page).toHaveURL(/\/processing/, { timeout: 60_000 });
  projectUrl = page.url().replace(/\/processing$/, "");
  await expect(page.getByTestId("open-draft")).toBeVisible({ timeout: 120_000 });

  const db = new PrismaClient({ datasources: { db: { url: "file:./e2e.db" } } });
  try {
    const id = projectUrl.split("/").pop()!;
    const words = [
      { text: "Open", start: 0.5, end: 0.8 }, { text: "the", start: 0.8, end: 1.0 }, { text: "queue.", start: 1.0, end: 1.5 },
      { text: "Um,", start: 1.7, end: 2.0 }, { text: "then", start: 4.5, end: 4.8 }, { text: "reset", start: 4.8, end: 5.2 }, { text: "it.", start: 5.2, end: 5.6 },
    ];
    await db.sourceAsset.updateMany({ where: { projectId: id }, data: { words: JSON.stringify(words) } });
  } finally { await db.$disconnect(); }

  await page.goto(`${projectUrl}/studio`);
  const transcript = page.getByTestId("studio-transcript");
  await expect(transcript.getByTestId("word")).toHaveCount(7);
  expect(await totalOf(page)).toBeCloseTo(10, 0);

  await transcript.getByTestId("word").nth(3).click(); // "Um,"
  await page.keyboard.press("Delete");
  await expect(transcript.getByTestId("word").nth(3)).toHaveClass(/cut/);
  expect(await totalOf(page)).toBeLessThan(9.8);
  await page.getByTestId("studio-undo").click();
  await expect(transcript.getByTestId("word").nth(3)).not.toHaveClass(/cut/);

  await expect(page.getByTestId("apply-tidy")).toHaveText(/1 fillers, 1 pauses/);
  await page.getByTestId("apply-tidy").click();
  await expect(transcript.getByTestId("word").nth(3)).toHaveClass(/cut/);
  const total = await totalOf(page);
  expect(total).toBeGreaterThan(7);
  expect(total).toBeLessThan(8);
  await expect(page.getByTestId("studio-save")).toHaveText("All changes saved", { timeout: 10_000 });
});

test("Annotations and audio options; personal data on screen is found and blurred", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "creator");
  await page.goto(`${projectUrl}/studio`);
  await page.keyboard.press("Home");
  await page.getByTestId("add-text").click();
  await page.getByTestId("note-text").fill("Reset the queue");
  await page.getByTestId("add-arrow").click();
  await expect(page.getByRole("group", { name: "Annotations" }).getByRole("button")).toHaveCount(2);
  await expect(page.getByTestId("preview-note")).toBeVisible(); // the text callout's handle (arrows have end points)
  await page.getByTestId("audio-normalize").check();
  await expect(page.getByTestId("studio-save")).toHaveText("All changes saved", { timeout: 10_000 });

  await page.getByTestId("find-pii").click();
  const result = page.getByTestId("pii-result");
  await expect(result).toContainText("Blurred", { timeout: 180_000 });
  await expect(result).toContainText("email address");
  await expect(result).toContainText("phone number");
  await expect(result).toContainText("name");
  await expect(page.getByTestId("preview-blur")).toHaveCount(3);
  await page.getByRole("group", { name: "Blur boxes" }).getByRole("button").first().click();
  await expect(page.getByTestId("auto-blur-label")).toContainText("Found automatically");
  // The annotations made before the detection are still there.
  await expect(page.getByRole("group", { name: "Annotations" }).getByRole("button")).toHaveCount(2);
});

test("The render has the cuts, the found blurs and the annotations", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, "creator");
  await page.goto(`${projectUrl}/studio`);
  const expected = await totalOf(page);
  await page.getByTestId("studio-render").click();
  await expect(page.getByRole("link", { name: "MP4" })).toBeVisible({ timeout: 180_000 });
  const mp4 = await page.request.get((await page.getByRole("link", { name: "MP4" }).first().getAttribute("href"))!);
  const dir = mkdtempSync(path.join(os.tmpdir(), "elks-studio2-"));
  try {
    const out = path.join(dir, "out.mp4");
    writeFileSync(out, await mp4.body());
    expect(Math.abs(durationOf(out) - expected)).toBeLessThan(0.6);
    // The e-mail address (around x 48-430, y 112-150) is blurred: far fewer hard edges than the original.
    expect(sharpness(area(out, 1, 120, 112, 300, 40), 300)).toBeLessThan(sharpness(area(fixture, 1, 120, 112, 300, 40), 300) * 0.3);
    // The text callout sits at 30-70% across, 40-48% down, on a dark label; that spot is light on the original.
    expect(mean(area(out, 1, 400, 296, 30, 30))).toBeLessThan(80);
    expect(mean(area(fixture, 1, 400, 296, 30, 30))).toBeGreaterThan(200);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

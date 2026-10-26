import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import ffmpeg from "ffmpeg-static";
import { PrismaClient } from "@prisma/client";
import { expect, test, type Page } from "@playwright/test";
import { signIn, switchPersona } from "./helpers";

/**
 * Studio phase 3 on a fake screen recording (clicks-screen.mp4, 10 s: a menu opens top right at 3 s,
 * the page changes at 7 s): automatic zoom, a chapter, 9:16 output, brand intro, lower third and outro,
 * music. Then the render is chosen for publishing, the version is approved, a v2 draft is started, and
 * the approved v1 still goes to Knowzy with the video's chapters (the approval snapshot).
 * The e2e server has speech switched off, so the AI voice (Kokoro) isn't tested here.
 */
test.describe.configure({ mode: "serial" });
const fixture = path.join(__dirname, "fixtures", "formats", "clicks-screen.mp4");
const FF = ffmpeg as unknown as string;
const TITLE = `Clicks screen ${Date.now().toString().slice(-5)}`;
let projectUrl = "";

/** The Studio inspector shows one tab at a time; older layouts show every panel (then there is no tab). */
async function tab(page: Page, name: "edit" | "assist" | "style" | "audio") {
  const t = page.getByTestId(`tab-${name}`);
  if (await t.count()) await t.click();
}
const probe = (file: string) => spawnSync(FF, ["-hide_banner", "-i", file]).stderr.toString();
function durationOf(info: string) {
  const m = info.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}
const frameGray = (file: string, t: number) => execFileSync(FF, ["-loglevel", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", "scale=180:320,format=gray", "-f", "rawvideo", "pipe:1"]);
const mean = (px: Buffer) => px.reduce((a, b) => a + b, 0) / px.length;
const withDb = async <T,>(fn: (db: PrismaClient) => Promise<T>) => {
  const db = new PrismaClient({ datasources: { db: { url: "file:./e2e.db" } } });
  try { return await fn(db); } finally { await db.$disconnect(); }
};

test("Zoom, chapter, 9:16, brand cards and music end up in the rendered MP4", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, "creator");
  await page.goto("/create/upload");
  await page.locator("#file").setInputFiles({ name: "clicks-screen.mp4", mimeType: "video/mp4", buffer: readFileSync(fixture) });
  await page.getByTestId("upload-continue").click({ timeout: 60_000 });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Title *").fill(TITLE);
  await page.getByLabel("Process category *").fill("IT support");
  await page.getByLabel("Country *").fill("Italy");
  await page.getByLabel("Intended audience *").fill("Store managers");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByTestId("wizard-create").click();
  await expect(page).toHaveURL(/\/processing/, { timeout: 60_000 });
  projectUrl = page.url().replace(/\/processing$/, "");
  await expect(page.getByTestId("open-draft")).toBeVisible({ timeout: 120_000 });

  await page.goto(`${projectUrl}/studio`);
  await expect(page.getByTestId("studio-time")).toBeVisible();

  await tab(page, "assist");
  await page.getByTestId("find-zooms").click();
  await expect(page.getByTestId("zoom-result")).toContainText("Added 1 zoom", { timeout: 120_000 });
  await expect(page.getByTestId("studio-zoomblock")).toHaveCount(1);

  await page.keyboard.press("Home");
  await page.getByTestId("studio-chapter-add").click();
  await tab(page, "edit");
  await page.getByTestId("chapter-title").fill("Open the menu");
  await expect(page.getByTestId("studio-chapter")).toHaveCount(1);

  await tab(page, "style");
  await page.getByTestId("output-aspect").selectOption("9:16");
  await page.getByTestId("output-fill").check();
  for (const id of ["brand-intro", "brand-lower-third", "brand-outro"]) await page.getByTestId(id).check();
  await expect(page.getByTestId("intro-preview")).toBeVisible();

  await tab(page, "audio");
  await page.getByTestId("music-track").selectOption("calm");
  await expect(page.getByTestId("studio-save")).toHaveText("All changes saved", { timeout: 10_000 });

  await page.getByTestId("studio-render").click();
  const mp4Link = page.getByRole("link", { name: "MP4" }).first();
  await expect(mp4Link).toBeVisible({ timeout: 240_000 });
  // The render lists its chapters (clicking one seeks the player) and its subtitle files.
  await expect(page.getByTestId("studio-render-chapters")).toContainText("Open the menu");
  await expect(page.getByTestId("studio-subtitles")).toContainText("EN");
  const vtt = await page.request.get((await page.getByTestId("studio-subtitles").getByRole("link").first().getAttribute("href"))!);
  expect(vtt.status()).toBe(200);
  expect(await vtt.text()).toMatch(/^WEBVTT/);

  const mp4 = await page.request.get((await mp4Link.getAttribute("href"))!);
  const dir = mkdtempSync(path.join(os.tmpdir(), "elks-studio3-"));
  try {
    const out = path.join(dir, "out.mp4");
    writeFileSync(out, await mp4.body());
    const info = probe(out);
    expect(info).toMatch(/Video: h264[^\n]*720x1280/);
    expect(Math.abs(durationOf(info) - 17)).toBeLessThan(0.6); // intro 3 s + 10 s + outro 4 s
    expect(info).toContain("Chapter #0:0");
    expect(info).toMatch(/Subtitle: mov_text/);
    expect(info).toMatch(/Audio: /);
    expect(mean(frameGray(out, 1))).toBeLessThan(90); // the navy intro card
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("The Studio render is chosen for publishing; the approved v1 is published with it while v2 is edited", async ({ page }) => {
  test.setTimeout(240_000);
  const id = projectUrl.split("/").pop()!;
  await signIn(page, "creator");
  await page.goto(`${projectUrl}/studio`);
  const choose = page.getByTestId("studio-render-row").first().getByTestId("use-for-publishing");
  await expect(choose).toHaveText("Use for publishing");
  await choose.click();
  await expect(choose).toHaveText("Chosen for publishing");

  // Review and approve v1. AI review flags on the generated draft would block approval; this test isn't about them.
  await withDb((db) => db.reviewFlag.updateMany({ where: { projectId: id }, data: { status: "dismissed" } }));
  const stepBefore = await withDb((db) => db.guideStep.findFirstOrThrow({ where: { projectId: id }, orderBy: { order: "asc" } }));
  await page.goto(`${projectUrl}/review`);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("submit-review").click();
  await expect(page.getByText(/Waiting for/)).toBeVisible();
  await switchPersona(page, "reviewer");
  await page.goto(`${projectUrl}/review`);
  await page.getByTestId("approve").click();
  await expect(page.getByText(/Waiting for Chiara Bellini/)).toBeVisible();
  await switchPersona(page, "approver");
  await page.goto(`${projectUrl}/review`);
  await page.getByTestId("approve").click();
  await expect(page.getByText(/Version 1 was approved/)).toBeVisible();

  // The creator starts v2 by editing the first step; v1 keeps its snapshot.
  await switchPersona(page, "creator");
  await page.goto(`${projectUrl}/guide`);
  const step = page.getByLabel("Step 1 instruction");
  await step.fill("Changed in version 2: this text must not reach Knowzy yet.");
  await step.blur();
  await expect(page.getByText(/Version 2 draft created/)).toBeVisible();
  await page.goto(projectUrl);
  await expect(page.getByText(/Snapshot saved/)).toBeVisible();

  await page.context().clearCookies();
  await signIn(page, "publisher");
  await page.goto(`${projectUrl}/publishing`);
  const video = page.getByTestId("publish-video");
  await expect(video).toContainText("Studio render");
  await expect(video).toContainText("00:17");
  await expect(video).toContainText("1 chapter");
  const knowzy = page.getByTestId("dest-knowzy");
  if (!(await knowzy.isChecked())) await knowzy.check();
  await page.getByTestId("publish").click();
  await expect(page.getByText(/Published v1/)).toBeVisible();

  const md = readFileSync(path.join("storage-e2e", "knowzy", "retail-europe", `${id}.en.md`), "utf8");
  expect(md).toContain(`# ${TITLE}`);
  expect(md).toContain(stepBefore.instruction.trim().split("\n")[0]!);
  expect(md).not.toContain("Changed in version 2");
  expect(md).toMatch(/## Video chapters\n\n- 00:0\d /);
  const meta = JSON.parse(readFileSync(path.join("storage-e2e", "knowzy", "retail-europe", `${id}.en.md.meta.json`), "utf8"));
  expect(meta.metadata.video).toMatchObject({ durationSec: 17 });
  const jobs = await withDb((db) => db.publishingJob.findMany({ where: { projectId: id } }));
  expect(jobs.length).toBeGreaterThan(0);
  expect(jobs.every((j) => j.renderId === meta.metadata.video.renderId)).toBe(true);
});

test("Studio edits the Video tab render of an audio project", async ({ page }) => {
  test.setTimeout(300_000);
  await signIn(page, "creator");
  await page.goto("/create/upload");
  await page.locator("#file").setInputFiles({ name: "sample.mp3", mimeType: "audio/mpeg", buffer: readFileSync(path.join(__dirname, "fixtures", "formats", "sample.mp3")) });
  await page.getByTestId("upload-continue").click({ timeout: 60_000 });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Title *").fill(`Audio in Studio ${Date.now().toString().slice(-5)}`);
  await page.getByLabel("Process category *").fill("Store operations");
  await page.getByLabel("Country *").fill("Italy");
  await page.getByLabel("Intended audience *").fill("Store managers");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByTestId("wizard-create").click();
  await expect(page).toHaveURL(/\/processing/, { timeout: 60_000 });
  const url = page.url().replace(/\/processing$/, "");
  await expect(page.getByTestId("open-draft")).toBeVisible({ timeout: 120_000 });

  await page.goto(`${url}/video`);
  await page.getByRole("checkbox", { name: /AI voice/ }).uncheck();
  await page.getByTestId("render-video").click();
  await expect(page.getByText("MP4 ready")).toBeVisible({ timeout: 180_000 });
  // The Video tab render can be chosen for publishing too.
  await page.getByTestId("use-for-publishing").first().click();
  await expect(page.getByTestId("use-for-publishing").first()).toHaveText("Chosen for publishing");

  await page.goto(`${url}/studio`);
  await expect(page.getByTestId("studio-base")).toContainText("Video tab render of v1");
  await expect(page.getByTestId("studio-clip")).toHaveCount(1);
  await page.getByTestId("studio-render").click();
  const link = page.getByRole("link", { name: "MP4" }).first();
  await expect(link).toBeVisible({ timeout: 180_000 });
  const mp4 = await page.request.get((await link.getAttribute("href"))!);
  expect(mp4.status()).toBe(200);
  const dir = mkdtempSync(path.join(os.tmpdir(), "elks-studio-audio-"));
  try {
    const out = path.join(dir, "out.mp4");
    writeFileSync(out, await mp4.body());
    const info = probe(out);
    expect(info).toMatch(/Video: h264/);
    expect(info).toMatch(/Audio: /);
    expect(durationOf(info)).toBeGreaterThan(5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("A platform administrator finds and deletes unused files; recent and referenced files stay", async ({ page }) => {
  const root = path.resolve("storage-e2e");
  const ws = readdirSync(root).find((d) => /^c[a-z0-9]{20,}$/.test(d) && statSync(path.join(root, d)).isDirectory()) ?? "e2eorphans";
  mkdirSync(path.join(root, ws), { recursive: true });
  const stale = path.join(root, ws, `orphan-${Date.now()}.bin`);
  const fresh = path.join(root, ws, `fresh-${Date.now()}.bin`);
  writeFileSync(stale, Buffer.alloc(2048));
  writeFileSync(fresh, Buffer.alloc(10));
  const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
  utimesSync(stale, twoDaysAgo, twoDaysAgo);
  const referenced = await withDb((db) => db.sourceAsset.findMany({ where: { storedBytes: true }, select: { storageKey: true } }));

  await signIn(page, "platform");
  await page.goto("/admin");
  const card = page.getByTestId("storage-cleanup");
  await card.getByTestId("cleanup-find").click();
  await expect(card.getByTestId("cleanup-result")).toContainText(/\d+ unused files?/);
  page.once("dialog", (d) => void d.accept());
  await card.getByTestId("cleanup-delete").click();
  await expect(card.getByTestId("cleanup-result")).toHaveText("No unused files.");
  expect(existsSync(stale)).toBe(false);
  expect(existsSync(fresh)).toBe(true);
  for (const r of referenced) expect(existsSync(path.join(root, r.storageKey))).toBe(true);
  rmSync(fresh, { force: true });

  await page.goto("/audit");
  await expect(page.getByRole("cell", { name: "storage.cleaned" }).first()).toBeVisible();
});

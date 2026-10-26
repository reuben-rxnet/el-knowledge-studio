import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";
import { makePdf } from "./fixtures/pdf";

/**
 * Every format the upload page lists goes all the way through: upload, processing, the video page
 * (real playback for media, real page images for documents and pictures) and a rendered MP4.
 * The fixtures in fixtures/formats are tiny: 6-second test-pattern videos with a tone, a 3-slide PPTX,
 * a 4-line DOCX. The e2e server runs with SPEECH_PROVIDER=off, so transcription is checked elsewhere.
 */
const dir = path.join(__dirname, "fixtures", "formats");
const file = (name: string) => readFileSync(path.join(dir, name));

type Format = { name: string; mime: string; buffer: () => Buffer; shows: "media" | "pages" | "text-slides"; pages?: number; text?: boolean };
const FORMATS: Format[] = [
  { name: "sample.mp4", mime: "video/mp4", buffer: () => file("sample.mp4"), shows: "media" },
  { name: "sample.mov", mime: "video/quicktime", buffer: () => file("sample.mov"), shows: "media" },
  { name: "sample.webm", mime: "video/webm", buffer: () => file("sample.webm"), shows: "media" },
  { name: "sample.mp3", mime: "audio/mpeg", buffer: () => file("sample.mp3"), shows: "media" },
  { name: "sample.wav", mime: "audio/wav", buffer: () => file("sample.wav"), shows: "media" },
  { name: "sample.pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", buffer: () => file("sample.pptx"), shows: "pages", pages: 3, text: true },
  { name: "sample.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: () => file("sample.docx"), shows: "pages", pages: 1, text: true },
  { name: "sample.pdf", mime: "application/pdf", buffer: () => makePdf(["Open Store Portal and select Close Day", "Count the cash drawer"]), shows: "pages", pages: 2, text: true },
  { name: "sample.txt", mime: "text/plain", buffer: () => file("sample.txt"), shows: "text-slides", text: true },
  { name: "sample.png", mime: "image/png", buffer: () => file("sample.png"), shows: "pages", pages: 1 },
  { name: "sample.jpg", mime: "image/jpeg", buffer: () => file("sample.jpg"), shows: "pages", pages: 1 },
];

async function createFrom(page: Page, f: Format) {
  await page.goto("/create/upload");
  await page.locator("#file").setInputFiles({ name: f.name, mimeType: f.mime, buffer: f.buffer() });
  await page.getByTestId("upload-continue").click();
  await page.getByRole("button", { name: "Continue" }).click(); // outputs
  await page.getByLabel("Title *").fill(`Format check ${f.name}`);
  await page.getByLabel("Process category *").fill("Store operations");
  await page.getByLabel("Country *").fill("Italy");
  await page.getByLabel("Intended audience *").fill("Store managers");
  await page.getByRole("button", { name: "Continue" }).click(); // context
  await page.getByRole("button", { name: "Continue" }).click(); // template
  await page.getByTestId("wizard-create").click();
  await expect(page).toHaveURL(/\/processing/, { timeout: 60_000 });
  return page.url().replace(/\/processing$/, "");
}

for (const f of FORMATS) {
  test(`${f.name}: uploads, processes, previews and renders`, async ({ page }) => {
    test.setTimeout(300_000);
    await signIn(page, "creator");
    const projectUrl = await createFrom(page, f);
    if (f.text) await expect(page.getByText(new RegExp(`characters of text extracted from ${f.name.replace(".", "\\.")}`))).toBeVisible({ timeout: 90_000 });
    if (f.pages) await expect(page.getByText(new RegExp(`${f.pages} (slide|page) images? made for the video`))).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("open-draft")).toBeVisible({ timeout: 120_000 });

    await page.goto(`${projectUrl}/video`);
    if (f.shows === "media") {
      // The browser can actually play it: metadata loads and the duration is the file's 6 seconds.
      const media = page.locator("video.player");
      await expect(media).toBeVisible();
      await expect.poll(() => media.evaluate((v: HTMLVideoElement) => (v.error ? -1 : v.duration || 0)), { timeout: 30_000 }).toBeGreaterThan(5);
    } else if (f.shows === "pages") {
      const slide = page.locator(".player img.slide");
      await expect(slide).toBeVisible();
      await expect.poll(() => slide.evaluate((img: HTMLImageElement) => img.naturalWidth), { timeout: 30_000 }).toBeGreaterThan(100);
    } else {
      await expect(page.locator(".player .screen")).toBeVisible(); // no pages: the stylised preview
    }

    await page.getByRole("checkbox", { name: /AI voice/ }).uncheck(); // "AI voice narration" or "Replace audio with AI voice"
    await page.getByTestId("render-video").click();
    await expect(page.getByText("MP4 ready")).toBeVisible({ timeout: 180_000 });
    const href = await page.getByRole("link", { name: "MP4" }).first().getAttribute("href");
    const mp4 = await page.request.get(href!);
    expect(mp4.status()).toBe(200);
    expect((await mp4.body()).length).toBeGreaterThan(5_000);
  });
}

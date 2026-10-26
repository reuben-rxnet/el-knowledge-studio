import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn, switchPersona } from "./helpers";
import { makePdf } from "./fixtures/pdf";

test.describe.configure({ mode: "serial" });
const twelve = () => readFileSync(path.join(__dirname, "fixtures", "formats", "twelve-seconds.mp4"));

async function uploadVideo(page: Page) {
  await page.goto("/create/upload");
  await page.locator("#file").setInputFiles({ name: "close-day-recording.mp4", mimeType: "video/mp4", buffer: twelve() });
  await expect(page.getByTestId("trim-split")).toBeVisible({ timeout: 60_000 });
}

async function finishWizard(page: Page) {
  await page.getByRole("button", { name: "Continue" }).click(); // outputs
  await page.getByLabel("Process category *").fill("Store operations");
  await page.getByLabel("Country *").fill("Italy");
  await page.getByLabel("Intended audience *").fill("Store managers");
  await page.getByRole("button", { name: "Continue" }).click(); // context
  await page.getByRole("button", { name: "Continue" }).click(); // template
}

test("A platform administrator sets a per-type limit on the web; it is audited and enforced in the browser and on the server", async ({ page }) => {
  // A workspace administrator sees the limits but can't change them.
  await signIn(page, "wsadmin");
  await page.goto("/admin");
  const card = page.getByTestId("upload-limits");
  await expect(card).toContainText("Only platform administrators can change these.");
  await expect(card.getByRole("spinbutton")).toHaveCount(0);

  await switchPersona(page, "platform");
  await page.goto("/admin");
  await card.getByLabel("PDF limit in megabytes").fill("5000");
  await card.getByTestId("save-upload-limits").click();
  await expect(card).toContainText("At most 2048 MB"); // the ceiling IT sets
  await card.getByLabel("PDF limit in megabytes").fill("1");
  await card.getByTestId("save-upload-limits").click();
  await expect(page.getByText("Upload limits saved.")).toBeVisible();
  await expect(card).toContainText(/Last changed .* by Inês Duarte/);
  await page.goto("/audit");
  await expect(page.getByRole("cell", { name: /Upload limits: PDF 200 MB → 1 MB/ })).toBeVisible();

  // The upload page shows the new limit and refuses a larger PDF before uploading anything.
  await page.goto("/create/upload");
  await expect(page.getByText(/PDF up to 1 MB/)).toBeVisible();
  await expect(page.getByText(/MP4, MOV, WEBM up to 1 GB/)).toBeVisible();
  const big = Buffer.concat([makePdf(["Big"]), Buffer.alloc(1024 * 1024 + 10, 32)]);
  await page.locator("#file").setInputFiles({ name: "manual.pdf", mimeType: "application/pdf", buffer: big });
  await expect(page.getByText(/PDF files can be up to 1 MB; this one is 2 MB/)).toBeVisible();

  // The server enforces it too, while the bytes stream in (a client that skips the browser check).
  const direct = await page.request.post("/api/uploads", { headers: { "x-file-name": "manual.pdf", "content-type": "application/pdf" }, data: big });
  expect(direct.status()).toBe(422);
  expect((await direct.json()).message).toContain("PDF files can be up to 1 MB");

  // Back to the default for the other tests.
  await page.goto("/admin");
  await card.getByLabel("PDF limit in megabytes").fill("200");
  await card.getByTestId("save-upload-limits").click();
  await expect(page.getByText("Upload limits saved.")).toBeVisible();
});

test("A video is trimmed after upload, and the project is made from the trimmed copy", async ({ page }) => {
  await signIn(page, "creator");
  await uploadVideo(page);
  await page.getByRole("radio", { name: "Trim" }).click();
  await expect(page.getByTestId("upload-continue")).toBeDisabled(); // a chosen trim must be applied first
  await page.getByLabel("Start").fill("0:02");
  await page.getByLabel("End").fill("0:09");
  await page.getByTestId("apply-cut").click();
  await expect(page.getByText(/Trimmed to 0:0[6-8]\./)).toBeVisible({ timeout: 60_000 }); // keyframe-aligned: about 7 s
  await page.getByTestId("upload-continue").click();
  await finishWizard(page);
  await expect(page.getByRole("cell", { name: /close-day-recording \(trimmed\)\.mp4/ })).toBeVisible();
  await page.getByTestId("wizard-create").click();
  await expect(page).toHaveURL(/\/processing/, { timeout: 60_000 });
});

test("A video is split into two parts, and each part becomes its own project", async ({ page }) => {
  await signIn(page, "creator");
  await uploadVideo(page);
  await page.getByRole("radio", { name: "Split into parts" }).click();
  await page.getByLabel("Split at").fill("0:06");
  await page.getByRole("button", { name: "Add split", exact: true }).click();
  await expect(page.getByText("2 parts: 0:00–0:06, 0:06–0:12")).toBeVisible();
  await page.getByTestId("apply-cut").click();
  await expect(page.getByText("Split into 2 parts. Each becomes its own project.")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("upload-continue").click();
  await finishWizard(page);
  await expect(page.getByRole("cell", { name: /2 projects, one per part/ })).toBeVisible();
  await expect(page.getByTestId("wizard-create")).toHaveText(/Create 2 projects and start processing/);
  await page.getByTestId("wizard-create").click();
  await expect(page).toHaveURL(/\/processing/, { timeout: 90_000 });
  // Each part links to the others.
  await page.goto(page.url().replace(/\/processing$/, ""));
  const nav = page.getByTestId("parts-nav");
  await expect(nav).toContainText("Part 1 of 2");
  await nav.getByRole("link", { name: /Part 2/ }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/\(part 2 of 2\)/);
  await expect(page.getByTestId("parts-nav")).toContainText("Part 2 of 2");
  await page.goto("/projects?scope=mine");
  await expect(page.getByText(/close day recording \(part 1 of 2\)/i).first()).toBeVisible();
  await expect(page.getByText(/close day recording \(part 2 of 2\)/i).first()).toBeVisible();
});

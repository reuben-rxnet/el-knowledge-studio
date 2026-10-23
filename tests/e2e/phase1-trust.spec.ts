import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { signIn, switchPersona } from "./helpers";

test.describe.configure({ mode: "serial" });
let projectUrl = "";

test("A document gets page citations, risky lines are flagged, and approval waits for a decision", async ({ page }) => {
  await signIn(page, "creator");
  await page.goto("/create/upload?kind=document");
  await page.locator("#file").setInputFiles({ name: "app-server-restart.txt", mimeType: "text/plain", buffer: readFileSync(path.join(process.cwd(), "eval/fixtures/app-server-restart.txt")) });
  await page.getByTestId("upload-continue").click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Process category *").fill("Server operations");
  await page.getByLabel("Country *").fill("Global");
  await page.getByLabel("Intended audience *").fill("IT operators");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByTestId("wizard-create").click();
  await expect(page).toHaveURL(/\/processing/);
  projectUrl = page.url().replace(/\/processing$/, "");
  await expect(page.getByTestId("open-draft")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/flagged for SME review/)).toBeVisible();

  // Documents are never cited with video timestamps.
  await page.goto(`${projectUrl}/knowledge`);
  await expect(page.getByText(/Source: app-server-restart\.txt/)).toBeVisible();
  await expect(page.locator("a.ts")).toHaveCount(0);
  await page.goto(`${projectUrl}/video`);
  await expect(page.getByText("Created from a document, so there is no recording.")).toBeVisible();

  // The risky line is flagged, and the creator submits.
  await page.goto(`${projectUrl}/review`);
  await expect(page.getByText("Risky instruction")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByTestId("submit-review").click();
  await expect(page.getByText("Submitted for SME review. The reviewer was notified.")).toBeVisible();
});

test("The SME can't approve until the risky flag is decided", async ({ page }) => {
  await signIn(page, "reviewer");
  await page.goto(`${projectUrl}/review`);
  await page.getByTestId("approve").click();
  await expect(page.getByText(/risky or contradictory statement\(s\) flagged by the AI are still open/)).toBeVisible();

  const risky = page.locator("li.para", { hasText: "Risky instruction" });
  await risky.getByRole("button", { name: "Decide" }).click();
  await risky.getByLabel("Your note").fill("Changed in source: stop and raise an incident if the queue can't be cleared.");
  await risky.getByRole("button", { name: "Resolved" }).click();
  await expect(page.getByText("Flag resolved. Your note was added to the comments.")).toBeVisible();

  await page.getByTestId("approve").click();
  await expect(page.getByText(/Waiting for Chiara Bellini/)).toBeVisible();
});

test("Quiz questions are approved one by one, and a translator approves a language", async ({ page }) => {
  await signIn(page, "approver");
  await page.goto(`${projectUrl}/knowledge`);
  await expect(page.getByText(/0 of \d+ approved/)).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).first().click();
  await expect(page.getByText(/1 of \d+ approved/)).toBeVisible();

  await switchPersona(page, "translator");
  await page.goto(`${projectUrl}/translations?lang=fr`);
  await expect(page.getByRole("button", { name: "Approve French" })).toBeDisabled();
  await page.getByRole("button", { name: "Mark all reviewed" }).click();
  await expect(page.getByText("All French segments marked reviewed.")).toBeVisible();
  await page.getByRole("button", { name: "Approve French" }).click();
  await expect(page.getByText("French approved. It can now be published.")).toBeVisible();
});

test("Phase 2: captions download as WebVTT, and a document project offers read-aloud narration", async ({ page }) => {
  await signIn(page, "creator");
  await page.goto(`${projectUrl}/video`);
  await expect(page.getByText("Created from a document, so there is no recording.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Play narration" })).toBeVisible();
  const href = await page.getByRole("link", { name: /English \.vtt/ }).getAttribute("href");
  const vtt = await page.request.get(href!);
  expect(vtt.headers()["content-type"]).toContain("text/vtt");
  const body = await vtt.text();
  expect(body.startsWith("WEBVTT")).toBe(true);
  expect(body).toMatch(/00:00:00\.000 --> /);
  // A project with no stored recording refuses to stream media.
  const media = await page.request.get(`${projectUrl.replace(/.*\/projects\//, "/api/projects/")}/media`);
  expect(media.status()).toBe(404);
});

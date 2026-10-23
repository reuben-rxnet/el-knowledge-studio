import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { signIn, switchPersona } from "./helpers";

test.describe.configure({ mode: "serial" });

const TITLE = `Store Closing Cash Count ${Date.now().toString().slice(-5)}`;
let projectUrl = "";

test("Journey 1 — creator creates content, processing completes, edits script and guide, submits for review", async ({ page }) => {
  await signIn(page, "creator");
  await page.goto("/create/wizard?source=document");
  await page.getByRole("button", { name: "Continue" }).click(); // source
  await page.getByRole("button", { name: "Continue" }).click(); // outputs
  await page.getByLabel("Title *").fill(TITLE);
  await page.getByLabel("Description and process notes").fill("End-of-day cash count in Store Portal, then deposit to the safe.");
  await page.getByLabel("Source system").fill("Store Portal");
  await page.getByLabel("Process category *").fill("Store operations");
  await page.getByLabel("Country *").fill("Italy");
  await page.getByLabel("Intended audience *").fill("Store managers");
  await page.getByRole("button", { name: "Continue" }).click(); // context
  await page.getByRole("button", { name: "Continue" }).click(); // template
  await expect(page.getByRole("cell", { name: TITLE })).toBeVisible();
  await page.getByTestId("wizard-create").click();

  await expect(page).toHaveURL(/\/projects\/[^/]+\/processing/);
  projectUrl = page.url().replace(/\/processing$/, "");
  await expect(page.getByText("Capture", { exact: true })).toBeVisible();
  await page.getByTestId("open-draft").click({ timeout: 90_000 });

  // Video editor: edit the first script paragraph.
  await expect(page).toHaveURL(/\/video/);
  const para = page.getByLabel("Script paragraph 1");
  await para.fill("Sign in to Store Portal with your own account and open Day Operations.");
  await para.blur();
  await expect(page.getByText("Script paragraph saved.")).toBeVisible();

  // Guide editor: edit step 1 instruction.
  await page.goto(`${projectUrl}/guide`);
  const step = page.getByLabel("Step 1 instruction");
  await step.fill("Sign in to Store Portal and open Day Operations, then select Close Day.");
  await step.blur();
  await expect(page.getByText("Step saved.")).toBeVisible();

  // Review: comment, then submit.
  await page.goto(`${projectUrl}/review`);
  await page.getByLabel("Comment", { exact: true }).fill("@Pierre please check the safe-deposit step.");
  await page.getByTestId("add-comment").click();
  await expect(page.getByText("@Pierre please check the safe-deposit step.")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByTestId("submit-review").click();
  await expect(page.getByText("Submitted for SME review. The reviewer was notified.")).toBeVisible();
  await expect(page.getByText(/Waiting for Pierre Laurent/)).toBeVisible();
});

test("Journey 2 — SME approves, approver approves the exact version", async ({ page }) => {
  await signIn(page, "reviewer");
  await page.goto(`${projectUrl}/review`);
  await page.getByTestId("approve").click();
  await expect(page.getByText(/Waiting for Chiara Bellini/)).toBeVisible();

  await switchPersona(page, "approver");
  await page.goto(`${projectUrl}/review`);
  await expect(page.getByTestId("approve")).toHaveText(/Approve v1/);
  await page.getByTestId("approve").click();
  await expect(page.getByText(/Version 1 was approved/)).toBeVisible();
});

test("Journey 4 — publisher releases to a clearly labelled mock SharePoint destination", async ({ page }) => {
  await signIn(page, "publisher");
  await page.goto(`${projectUrl}/publishing`);
  await expect(page.getByText("Mock connectors · nothing is sent")).toBeVisible();
  await page.getByTestId("publish").click();
  await expect(page.getByText(/simulated: no external system was contacted/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Publishing history" })).toBeVisible();
});

test("Journey 5 — consumer searches, gets a grounded answer and opens the exact chapter", async ({ page }) => {
  await signIn(page, "consumer");
  await page.goto(`/knowledge?q=${encodeURIComponent("How do I open the POS day?")}`);
  await expect(page.getByText(/Grounded in \d source/)).toBeVisible();
  await expect(page.getByText(/Verify critical operational, safety, financial, legal, or compliance decisions/)).toBeVisible();
  await page.locator("a.src").first().click();
  await expect(page).toHaveURL(/\/video\?scene=/);
  await expect(page.locator(".scene.sel")).toBeVisible();
});

test("Audit history records the whole journey", async ({ page }) => {
  await signIn(page, "wsadmin");
  await page.goto("/audit");
  for (const action of ["project.created", "content.edited", "review.submitted", "approval.granted", "content.published"]) {
    await expect(page.getByRole("cell", { name: action }).first()).toBeVisible();
  }
});

test("Permissions are enforced on the server, not only hidden", async ({ page }) => {
  await signIn(page, "consumer");
  await expect(page.getByRole("button", { name: "Create" })).toHaveCount(0);
  await page.goto("/create");
  await expect(page.getByText("Your role can't create content")).toBeVisible();
  await page.goto("/audit");
  await expect(page.getByText("You don't have access to the audit history")).toBeVisible();
  // Projects in workspaces the user doesn't belong to answer like missing ones.
  await page.goto("/projects/cl0000000000000000000000");
  await expect(page.getByText("This page or project isn't available")).toBeVisible();
});

test("Home and Knowledge Hub have no serious accessibility violations", async ({ page }) => {
  await signIn(page, "creator");
  for (const path of ["/", "/knowledge", "/projects"]) {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${path}: ${v.id} — ${v.help} — ${v.nodes.map((n) => `${n.target.join(" ")} (${n.any[0]?.message ?? ""})`).join("; ")}`)).toEqual([]);
  }
});

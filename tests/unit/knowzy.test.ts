import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VersionSnapshot } from "@/lib/domain/version-snapshot";

// loadGuide reads the database; these tests hand it the rows instead.
const rows = vi.hoisted(() => ({ project: null as unknown, version: null as unknown, render: null as unknown, translation: null as unknown, segments: [] as unknown[] }));
vi.mock("@/lib/database/client", () => ({
  db: {
    project: { findUnique: async () => rows.project },
    projectVersion: { findUnique: async () => rows.version },
    renderJob: { findFirst: async () => rows.render },
    translationProject: { findUnique: async () => rows.translation },
    translationSegment: { findMany: async () => rows.segments },
  },
}));

import { knowzyMarkdown, knowzySidecar, loadGuide, type KnowzyGuide } from "@/lib/services/knowzy";

const guide: KnowzyGuide = {
  projectId: "p1", title: "Close the POS day", description: "End-of-day routine.", version: 3, language: "en", classification: "Internal",
  workspace: { slug: "retail-europe", name: "Retail Operations · Europe" }, businessFunction: "Retail", processCategory: "Store operations",
  sourceSystem: "Store Portal", audience: "Store managers", owner: "Amara Mensah", approvedAt: new Date("2026-10-20T09:00:00Z"),
  steps: [
    { chapter: "Prepare", title: "Open the\nreport", instruction: "Go to Reports.", expectedResult: "The report opens.", warning: null, tip: null },
    { chapter: "Prepare", title: "Count cash", instruction: "Count the drawer.", expectedResult: null, warning: "Two people must be present.", tip: "Use the counting tray." },
    { chapter: "Close", title: "Close the day", instruction: "Select Close day.", expectedResult: null, warning: null, tip: null },
  ],
  faqs: [{ question: "What if the totals differ?", answer: "Recount, then call your area manager." }],
};

describe("Knowzy export", () => {
  it("writes the approved guide as Markdown with chapters, numbered steps and notes", () => {
    const md = knowzyMarkdown(guide);
    expect(md.startsWith("# Close the POS day\n")).toBe(true);
    expect(md).toContain("- Version: 3 (approved 2026-10-20)");
    expect(md.match(/^## Prepare$/gm)).toHaveLength(1); // one heading per chapter, not per step
    expect(md).toContain("### Step 1. Open the report"); // line breaks can't split a heading
    expect(md).toContain("> **Warning:** Two people must be present.");
    expect(md).toContain("### Step 3. Close the day");
    expect(md).toContain("## Frequently asked questions");
    expect(md).not.toContain("## Video chapters");
  });

  it("lists the official video's chapters with mm:ss timestamps", () => {
    const g = { ...guide, video: { renderId: "r1", durationSec: 95, chapters: [{ start: 0, end: 12.4, title: "Open the\nreport" }, { start: 72.6, end: 95, title: "Close" }] } };
    const md = knowzyMarkdown(g);
    expect(md).toContain("## Video chapters\n\n- 00:00 Open the report\n- 01:12 Close\n");
    expect(md.indexOf("## Video chapters")).toBeLessThan(md.indexOf("## Frequently asked questions"));
    expect(knowzySidecar(g).metadata.video).toEqual({ renderId: "r1", durationSec: 95, chapters: g.video.chapters });
  });

  it("describes the document in Knowzy's sidecar format", () => {
    expect(knowzySidecar(guide)).toMatchObject({ sourceVersion: "3", sourceModifiedAt: "2026-10-20T09:00:00.000Z", mimeType: "text/markdown", metadata: { projectId: "p1", classification: "Internal", workspace: "Retail Operations · Europe" } });
    expect(knowzySidecar(guide)).not.toHaveProperty("access"); // Knowzy decides access, not the export
    expect(knowzySidecar(guide).metadata).not.toHaveProperty("video");
  });
});

describe("Knowzy export: which content", () => {
  const liveStep = { id: "s1", order: 1, chapter: "Live", title: "Edited in v4", instruction: "Draft text.", expectedResult: null, warning: null, tip: null, sourceRef: null };
  const project = (currentVersion: number) => ({
    id: "p1", title: "Live title", description: "Live description", approvedVersion: 3, currentVersion, primaryLanguage: "en", classification: "Internal",
    workspace: { slug: "retail-europe", name: "Retail" }, owner: { displayName: "Amara Mensah" }, businessFunction: "Retail", processCategory: "Ops", sourceSystem: "POS", audience: "Staff",
    lastReviewedAt: new Date("2026-10-20T09:00:00Z"), steps: [liveStep], faqs: [{ question: "Live?", answer: "Yes" }],
  });
  const snapshot: VersionSnapshot = {
    format: 1, version: 3, takenAt: "2026-10-20T09:00:00Z", title: "Approved title", description: "Approved description", primaryLanguage: "en",
    steps: [
      { id: "s2", order: 2, chapter: "Close", title: "Close the day", instruction: "Select Close day.", expectedResult: null, warning: null, tip: null, sourceRef: null },
      { id: "s1", order: 1, chapter: "Prepare", title: "Open the report", instruction: "Go to Reports.", expectedResult: "It opens.", warning: null, tip: null, sourceRef: null },
    ],
    faqs: [{ question: "Approved?", answer: "Yes" }], script: [],
    translations: [{ language: "it", sourceType: "step-title", sourceId: "s1", text: "Apri il report", status: "reviewed" }],
    approvedLanguages: ["it"],
  };
  beforeEach(() => { rows.render = null; rows.translation = null; rows.segments = []; });

  it("uses the live tables while the approved version is the current one", async () => {
    rows.project = project(3);
    rows.version = { snapshot: JSON.stringify(snapshot), officialRenderId: null, createdAt: new Date() };
    const g = await loadGuide("p1", 3, "en");
    expect(g.title).toBe("Live title");
    expect(g.steps.map((s) => s.title)).toEqual(["Edited in v4"]);
    expect(g.video).toBeUndefined();
  });

  it("uses the approval snapshot once a newer draft is being edited", async () => {
    rows.project = project(4);
    rows.version = { snapshot: JSON.stringify(snapshot), officialRenderId: "r1", createdAt: new Date() };
    rows.render = { id: "r1", durationSec: 17, chapters: JSON.stringify([{ start: 3, end: 17, title: "Intro" }]) };
    const g = await loadGuide("p1", 3, "en");
    expect(g.title).toBe("Approved title");
    expect(g.steps.map((s) => s.title)).toEqual(["Open the report", "Close the day"]);
    expect(g.faqs).toEqual([{ question: "Approved?", answer: "Yes" }]);
    expect(g.video).toEqual({ renderId: "r1", durationSec: 17, chapters: [{ start: 3, end: 17, title: "Intro" }] });
    const it = await loadGuide("p1", 3, "it");
    expect(it.steps[0]).toMatchObject({ title: "Apri il report", expectedResult: null });
    expect(it.faqs).toEqual([]);
    await expect(loadGuide("p1", 3, "fr")).rejects.toThrow("wasn't approved when version 3 was approved");
  });

  it("refuses an older approval without a snapshot, as before", async () => {
    rows.project = project(4);
    rows.version = { snapshot: null, officialRenderId: null, createdAt: new Date() };
    await expect(loadGuide("p1", 3, "en")).rejects.toThrow("Version 4 is being edited");
    await expect(loadGuide("p1", 2, "en")).rejects.toThrow("Only the approved version");
  });
});

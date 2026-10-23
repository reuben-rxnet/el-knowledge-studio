import { describe, expect, it } from "vitest";
import { knowzyMarkdown, knowzySidecar, type KnowzyGuide } from "@/lib/services/knowzy";

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
  });

  it("describes the document in Knowzy's sidecar format", () => {
    expect(knowzySidecar(guide)).toMatchObject({ sourceVersion: "3", sourceModifiedAt: "2026-10-20T09:00:00.000Z", mimeType: "text/markdown", metadata: { projectId: "p1", classification: "Internal", workspace: "Retail Operations · Europe" } });
    expect(knowzySidecar(guide)).not.toHaveProperty("access"); // Knowzy decides access, not the export
  });
});

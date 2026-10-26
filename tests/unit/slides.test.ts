import { describe, expect, it } from "vitest";
import { pageIndexOf, pagesForScenes } from "@/lib/services/local/slides";

describe("slide images for chapters", () => {
  it("reads the page a step cites", () => {
    expect(pageIndexOf("Slide 4")).toBe(3);
    expect(pageIndexOf("Page 2")).toBe(1);
    expect(pageIndexOf("Introduction")).toBeNull();
    expect(pageIndexOf(null)).toBeNull();
  });

  it("shows each chapter its cited slide, keeping the last one for chapters without a reference", () => {
    // The KNOWZY deck: several chapters come from slide 4, one has no reference.
    expect(pagesForScenes(6, ["Slide 1", "Slide 2", "Slide 4", "Slide 4", null, "Slide 12"], 12)).toEqual([0, 1, 3, 3, 3, 11]);
  });

  it("falls back to page order when nothing is cited, and ignores pages that don't exist", () => {
    expect(pagesForScenes(4, [null, null, null, null], 2)).toEqual([0, 1, 1, 1]);
    expect(pagesForScenes(2, ["Slide 1", "Slide 40"], 3)).toEqual([0, 0]);
    expect(pagesForScenes(3, ["Slide 1", null, null], 0)).toEqual([null, null, null]);
  });
});

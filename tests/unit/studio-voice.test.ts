import { describe, expect, it } from "vitest";
import { defaultEdl, removeClip, splitAt } from "@/lib/studio/edl";
import { voicePlacement, voiceSpeed } from "@/lib/studio/render-args";

describe("Studio AI voice placement", () => {
  const cues = [
    { start: 6, end: 8, text: "Then save." },
    { start: 0.5, end: 3, text: "Open the menu." },
    { start: 3.5, end: 5, text: "This part is cut." },
  ];

  it("starts each paragraph where its caption starts, after the intro, with the time until the next one", () => {
    const placed = voicePlacement(defaultEdl(10), cues, 3, 17);
    expect(placed.map((p) => p.text)).toEqual(["Open the menu.", "This part is cut.", "Then save."]);
    expect(placed.map((p) => p.at)).toEqual([3.5, 6.5, 9]);
    expect(placed[0]!.slot).toBeCloseTo(2.85); // until the next paragraph, less a short gap
    expect(placed[2]!.slot).toBeCloseTo(7.85); // the last one runs to the end of the video
  });

  it("follows the cuts and leaves out paragraphs on cut material", () => {
    // Clips: 0-3.2 | 3.2-5.5 (deleted) | 5.5-10, so "Then save." moves 2.3 s earlier.
    const e = removeClip(splitAt(splitAt(defaultEdl(10), 3.2, "c2"), 5.5, "c3"), 1);
    const placed = voicePlacement(e, cues, 0, 7.7);
    expect(placed.map((p) => p.text)).toEqual(["Open the menu.", "Then save."]);
    expect(placed[1]!.at).toBeCloseTo(3.7);
  });

  it("speeds a long paragraph up to fit, but never above 1.35x", () => {
    expect(voiceSpeed(2, 3)).toBe(1);
    expect(voiceSpeed(3.3, 3)).toBeCloseTo(1.1);
    expect(voiceSpeed(9, 3)).toBe(1.35);
  });
});

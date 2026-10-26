import { describe, expect, it } from "vitest";
import {
  addBlur, clipBlurs, clipCues, defaultEdl, edlProblem, locate, moveClip, outputCues, outputDuration, removeClip, setSpeed, splitAt, toOutput, trimClip, updateBlur, type Edl,
} from "@/lib/studio/edl";
import { atempoChain, segmentFilter } from "@/lib/studio/render-args";

const sixty = () => defaultEdl(60);

describe("Studio edit list", () => {
  it("splits, deletes and reorders clips, and the output time follows", () => {
    let e = splitAt(sixty(), 20, "c2");             // [0-20][20-60]
    e = splitAt(e, 30, "c3");                       // [0-20][20-30][30-60]
    expect(e.clips.map((c) => [c.srcIn, c.srcOut])).toEqual([[0, 20], [20, 30], [30, 60]]);
    e = removeClip(e, 1);                           // cut 20-30
    expect(outputDuration(e)).toBe(50);
    expect(locate(e, 25)).toEqual({ index: 1, srcTime: 35 }); // 25 s into the output is 35 s into the source
    e = moveClip(e, 1, 0);                          // [30-60][0-20]
    expect(locate(e, 0).srcTime).toBe(30);
    expect(removeClip(defaultEdl(10), 0).clips).toHaveLength(1); // the last clip stays
  });

  it("doesn't split right at a clip edge", () => {
    expect(splitAt(sixty(), 0.05, "x").clips).toHaveLength(1);
  });

  it("speeds a clip up: shorter output, captions squeezed to match", () => {
    let e = splitAt(sixty(), 30, "c2");
    e = setSpeed(e, 1, 4);                          // [0-30 at 1x][30-60 at 4x]
    expect(outputDuration(e)).toBe(37.5);
    expect(outputCues(e, [{ start: 28, end: 40, text: "Click Save" }])).toEqual([
      { start: 28, end: 30, text: "Click Save" },
      { start: 30, end: 32.5, text: "Click Save" },
    ]);
    expect(setSpeed(e, 0, 3).clips[0]!.speed).toBe(1); // only the offered speeds
  });

  it("keeps trims inside the recording and at least 0.2 s long", () => {
    const e = trimClip(sixty(), 0, { srcIn: -5, srcOut: 90 });
    expect(e.clips[0]).toMatchObject({ srcIn: 0, srcOut: 60 });
    expect(trimClip(sixty(), 0, { srcIn: 59.99 }).clips[0]).toMatchObject({ srcIn: 59.8, srcOut: 60 });
  });

  it("anchors blur boxes to the source, so they follow the content when clips move", () => {
    let e = addBlur(splitAt(sixty(), 30, "c2"), 40, "b1"); // a blur from source 40 s, 5 s long
    expect(e.blurs[0]).toMatchObject({ srcStart: 40, srcEnd: 45 });
    e = moveClip(e, 1, 0);                                // that content now plays first
    expect(toOutput(e, 40, 45)).toEqual([{ start: 10, end: 15, clip: 0 }]);
    expect(clipBlurs(e, 0)[0]).toMatchObject({ start: 10, end: 15 });
    e = updateBlur(e, "b1", { x: 0.9, w: 0.3 });          // kept inside the frame
    expect(e.blurs[0]!.x + e.blurs[0]!.w).toBeLessThanOrEqual(1);
  });

  it("gives each clip its own captions in its own time", () => {
    const e = splitAt(sixty(), 30, "c2");
    expect(clipCues(e, 1, [{ start: 29, end: 33, text: "Open the report" }])).toEqual([{ start: 0, end: 3, text: "Open the report" }]);
  });

  it("rejects lists that don't fit the real recording", () => {
    const bad: Edl = { ...sixty(), clips: [{ id: "c1", srcIn: 0, srcOut: 75, speed: 1 }] };
    expect(edlProblem(bad, 60)).toMatch(/ends after the recording/);
    expect(edlProblem(sixty(), 60)).toBeNull();
  });
});

describe("Studio render commands", () => {
  it("chains atempo for speeds outside 0.5-2", () => {
    expect(atempoChain(1)).toEqual([]);
    expect(atempoChain(4)).toEqual(["atempo=2", "atempo=2"]);
    expect(atempoChain(8)).toEqual(["atempo=2", "atempo=2", "atempo=2"]);
    expect(atempoChain(0.75)).toEqual(["atempo=0.75"]);
  });

  it("blurs only the box, only while it's active, before scaling", () => {
    const e = addBlur(sixty(), 10, "b1");
    const f = segmentFilter(e, 0, { hasAudio: true, captions: "clip-1.srt" });
    expect(f).toContain("crop=w=iw*0.3:h=ih*0.15:x=iw*0.35:y=ih*0.4");
    expect(f).toContain("enable='between(t,10,15)'");
    expect(f.indexOf("boxblur")).toBeLessThan(f.indexOf("scale=1280:720"));
    expect(f).toContain("subtitles=clip-1.srt");
    expect(segmentFilter(e, 0, { hasAudio: false, captions: null })).toContain("anullsrc");
  });
});

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

describe("Studio phase 2: editing by text", () => {
  const words = [
    { text: "Open", start: 0.5, end: 0.8 }, { text: "the", start: 0.8, end: 0.95 }, { text: "report.", start: 0.95, end: 1.4 },
    { text: "Um,", start: 1.5, end: 1.8 }, { text: "then", start: 4.0, end: 4.3 }, { text: "click", start: 4.3, end: 4.6 }, { text: "Save.", start: 4.6, end: 5.0 },
  ];

  it("cuts a stretch of the recording out of whichever clips show it", async () => {
    const { cutSource } = await import("@/lib/studio/edl");
    let n = 0;
    const e = cutSource(defaultEdl(10), 2, 3, () => `x${++n}`);
    expect(e.clips.map((c) => [c.srcIn, c.srcOut])).toEqual([[0, 2], [3, 10]]);
    expect(outputDuration(e)).toBe(9);
    // A stretch across a clip boundary shortens both sides; cutting everything is refused.
    const e2 = cutSource(e, 1.5, 3.5, () => `x${++n}`);
    expect(e2.clips.map((c) => [c.srcIn, c.srcOut])).toEqual([[0, 1.5], [3.5, 10]]);
    expect(cutSource(defaultEdl(10), 0, 10, () => "y").clips).toHaveLength(1);
  });

  it("finds filler words and long pauses, keeping a short gap", async () => {
    const { tidyCuts } = await import("@/lib/studio/edl");
    const cuts = tidyCuts(defaultEdl(10), words, { fillers: true, pauseSec: 1, keepSec: 0.4 });
    expect(cuts).toEqual([
      { start: 1.5, end: 1.8, kind: "filler" },
      { start: 2.0, end: 3.8, kind: "pause" }, // 1.8 -> 4.0 minus 0.2 kept on each side
    ]);
    expect(tidyCuts(defaultEdl(10), words, { fillers: false, pauseSec: null })).toEqual([]);
  });
});

describe("Studio phase 2: annotations", () => {
  it("adds, keeps inside the frame, and follows the content like blurs", async () => {
    const { addAnnotation, updateAnnotation, clipAnnotations, moveClip: move } = await import("@/lib/studio/edl");
    let e = addAnnotation(splitAt(sixty(), 30, "c2"), 40, "badge", "n1");
    expect(e.annotations[0]).toMatchObject({ kind: "badge", text: "1", srcStart: 40, srcEnd: 44 });
    e = addAnnotation(e, 40, "badge", "n2");
    expect(e.annotations[1]!.text).toBe("2"); // step numbers count up
    e = updateAnnotation(e, "n1", { x: 0.99 });
    expect(e.annotations[0]!.x + e.annotations[0]!.w).toBeLessThanOrEqual(1);
    e = move(e, 1, 0);
    expect(clipAnnotations(e, 0)[0]).toMatchObject({ start: 10, end: 14 });
  });

  it("loads phase 1 edit lists, which have no annotations or audio options", async () => {
    const { edlSchema } = await import("@/lib/studio/edl");
    const old = { v: 1, sourceDuration: 12, clips: [{ id: "c1", srcIn: 0, srcOut: 12, speed: 1 }], blurs: [] };
    expect(edlSchema.parse(old)).toMatchObject({ annotations: [], audio: { denoise: false, normalize: false } });
  });

  it("overlays each annotation layer while it's active, and adds noise reduction when asked", async () => {
    const { addAnnotation, setAudio } = await import("@/lib/studio/edl");
    const e = setAudio(addAnnotation(sixty(), 5, "arrow", "n1"), { denoise: true });
    const f = segmentFilter(e, 0, { hasAudio: true, captions: null, layers: [{ input: 1, start: 5, end: 9 }] });
    expect(f).toContain("[1:v]overlay=0:0:enable='between(t,5,9)'");
    expect(f).toContain("afftdn");
  });
});

describe("Studio phase 2: personal data on screen", () => {
  it("finds emails, phone numbers and known names, without overlapping boxes", async () => {
    const { ruleMatches } = await import("@/lib/services/local/pii");
    const line = "From: jane.doe@example.com Phone: +1 555 0100 2233 Regards, Jane Doe";
    const m = ruleMatches(line, ["Jane Doe", "jane doe"]);
    expect(m.map((x) => [x.label, line.slice(x.start, x.end)]).sort()).toEqual([
      ["Email address", "jane.doe@example.com"], ["Name", "Jane Doe"], ["Phone number", "+1 555 0100 2233"],
    ]);
    expect(ruleMatches("Order 1234 of 2025", [])).toEqual([]); // short numbers aren't phone numbers
  });

  it("joins the same item on consecutive frames into one box, covering one sample either side", async () => {
    const { trackDetections } = await import("@/lib/services/local/pii");
    const b = { x: 0.1, y: 0.1, w: 0.2, h: 0.05, label: "Email address" };
    const boxes = trackDetections([{ t: 4, boxes: [b] }, { t: 6, boxes: [b] }, { t: 8, boxes: [] }, { t: 20, boxes: [b] }], 2, 30);
    expect(boxes.map((x) => [x.srcStart, x.srcEnd])).toEqual([[2, 8], [18, 22]]);
  });
});

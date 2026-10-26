import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import ffmpeg from "ffmpeg-static";
import { describe, expect, it } from "vitest";
import {
  addChapter, addZoom, defaultEdl, edlSchema, outputChapters, removeClip, replaceAutoZooms, splitAt, updateZoom, viewAt, zoomWeight, type Edl,
} from "@/lib/studio/edl";
import { cardArgs, ffmetadataChapters, finishArgs, iso3, segmentFilter } from "@/lib/studio/render-args";

const FF = ffmpeg as unknown as string;

describe("Studio phase 3: zooms and the camera", () => {
  it("eases in and out, and shows the focus area at the zoom's scale", () => {
    const e = updateZoom(addZoom(defaultEdl(10), 2, "z1"), "z1", { x: 0.25, y: 0.3, scale: 2, srcEnd: 6 });
    const z = e.zooms[0]!;
    expect(zoomWeight(z, 1.9)).toBe(0);
    expect(zoomWeight(z, 2.3)).toBeGreaterThan(0);
    expect(zoomWeight(z, 2.3)).toBeLessThan(1);
    expect(zoomWeight(z, 4)).toBe(1);
    const v = viewAt(e, 4, 16 / 9);
    expect(v.w).toBeCloseTo(0.5); expect(v.h).toBeCloseTo(0.5);
    expect(v.x).toBe(0); // centre 0.25 with width 0.5 would start at 0: kept inside the frame
    expect(v.y).toBeCloseTo(0.05);
    expect(viewAt(e, 8, 16 / 9)).toMatchObject({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("fills a vertical frame with a centred slice that follows the zoom's focus", () => {
    const e: Edl = { ...defaultEdl(10), output: { aspect: "9:16", fit: "fill" } };
    const v = viewAt(e, 1, 16 / 9);
    expect(v.h).toBe(1);
    expect(v.w).toBeCloseTo((9 / 16) / (16 / 9));
    expect(v.x).toBeCloseTo((1 - v.w) / 2);
    const z = updateZoom(addZoom(e, 0, "z"), "z", { x: 0.9, y: 0.5, scale: 1.5 });
    expect(viewAt(z, 1.5, 16 / 9).x).toBeCloseTo(1 - viewAt(z, 1.5, 16 / 9).w); // moved right, up to the edge
  });

  it("replaces only the found zooms, and old edit lists load with no zooms", () => {
    let e = addZoom(defaultEdl(20), 1, "mine");
    e = replaceAutoZooms(e, [{ id: "a1", srcStart: 5, srcEnd: 8, x: 0.5, y: 0.5, scale: 2 }]);
    e = replaceAutoZooms(e, [{ id: "a2", srcStart: 10, srcEnd: 12, x: 0.4, y: 0.4, scale: 1.5 }]);
    expect(e.zooms.map((z) => z.id)).toEqual(["mine", "a2"]);
    const old = edlSchema.parse({ v: 1, sourceDuration: 5, clips: [{ id: "c1", srcIn: 0, srcOut: 5, speed: 1 }], blurs: [] });
    expect(old).toMatchObject({ zooms: [], chapters: [], output: { aspect: "16:9", fit: "fit" }, music: { track: null }, captionLanguage: null });
  });

  it("renders the same rectangle as the preview: a zoomed frame matches a plain crop of viewAt()", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "elks-cam-"));
    try {
      execFileSync(FF, ["-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=s=1920x1080:r=30:d=4", "-pix_fmt", "yuv420p", path.join(dir, "src.mp4")]);
      const e = updateZoom(addZoom(defaultEdl(4), 0, "z"), "z", { srcStart: 0, srcEnd: 4, x: 0.7, y: 0.35, scale: 2.5 });
      writeFileSync(path.join(dir, "f.txt"), segmentFilter(e, 0, { hasAudio: false, captions: null, srcAspect: 16 / 9 }));
      execFileSync(FF, ["-loglevel", "error", "-i", "src.mp4", "-filter_complex_script", "f.txt", "-map", "[vout]", "-ss", "2", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-s", "320x180", "zoomed.raw", "-map", "[aout]", "-f", "null", "-"], { cwd: dir });
      const v = viewAt(e, 2, 16 / 9);
      const crop = `crop=${Math.round(v.w * 1920)}:${Math.round(v.h * 1080)}:${Math.round(v.x * 1920)}:${Math.round(v.y * 1080)},scale=320:180`;
      execFileSync(FF, ["-loglevel", "error", "-ss", "2", "-i", "src.mp4", "-vf", crop, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "expected.raw"], { cwd: dir });
      const a = readFileSync(path.join(dir, "zoomed.raw")), b = readFileSync(path.join(dir, "expected.raw"));
      let diff = 0;
      for (let i = 0; i < a.length; i++) diff += Math.abs(a[i]! - b[i]!);
      expect(a.length).toBe(320 * 180);
      expect(diff / a.length).toBeLessThan(6); // same picture, small resampling differences only
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("Studio phase 3: chapters, cards and the finishing pass", () => {
  it("puts chapters on the output timeline, drops cut ones and starts the first at 0", () => {
    let e = splitAt(defaultEdl(60), 20, "c2");
    e = splitAt(e, 30, "c3");
    e = addChapter(e, 5, "k1", "Open the queue");
    e = addChapter(e, 25, "k2", "Gone");             // inside 20-30, which is cut next
    e = addChapter(e, 40, "k3", "Reset it");
    e = removeClip(e, 1);
    expect(outputChapters(e)).toEqual([{ start: 0, end: 30, title: "Open the queue" }, { start: 30, end: 50, title: "Reset it" }]);
    expect(outputChapters(e, 3, 4)).toEqual([{ start: 0, end: 33, title: "Open the queue" }, { start: 33, end: 57, title: "Reset it" }]);
    expect(ffmetadataChapters([{ start: 0, end: 1.5, title: "A=B; #1" }])).toContain("title=A\\=B\\; \\#1");
  });

  it("ducks music under the voice, adds soft subtitles per language and chapters, copying the picture", () => {
    const a = finishArgs({ input: "joined.mp4", output: "out.mp4", duration: 12, music: "m.m4a", musicVolume: 0.3, duck: true, normalize: true, subtitles: [{ file: "en.srt", language: "en" }, { file: "it.srt", language: "it" }], chapters: "ch.txt" });
    const graph = a[a.indexOf("-filter_complex") + 1]!;
    expect(graph).toContain("sidechaincompress");
    expect(graph).toContain("loudnorm");
    expect(a).toContain("-stream_loop");
    expect(a.join(" ")).toContain("-c:v copy");
    expect(a.join(" ")).toContain("-c:s mov_text");
    expect(a.join(" ")).toContain("language=ita");
    expect(a.join(" ")).toContain("-map_chapters 4");
    expect(iso3("pt-BR")).toBe("por");
    expect(cardArgs("intro.png", 3, "card.mp4")).toContain("-loop");
  });

  it("mutes the recording's sound when the AI voice replaces it, and keeps captions out of the zoom", () => {
    const e = addZoom(defaultEdl(10), 1, "z");
    const f = segmentFilter(e, 0, { hasAudio: true, captions: "c.srt", mute: true, overlays: [{ input: 1, start: 0, end: 5 }] });
    expect(f).toContain("anullsrc");
    expect(f.indexOf("perspective")).toBeLessThan(f.indexOf("[1:v]overlay"));
    expect(f.indexOf("[1:v]overlay")).toBeLessThan(f.indexOf("subtitles="));
  });
});

describe("Studio phase 3: automatic zoom from screen changes", () => {
  it("zooms on a menu that opens, not across a page change", async () => {
    const { detectActivity, zoomsFromEvents } = await import("@/lib/services/local/activity");
    const events = await detectActivity(path.join(process.cwd(), "tests", "e2e", "fixtures", "formats", "clicks-screen.mp4"));
    expect(events.some((e) => e.page && Math.abs(e.t - 7) < 0.3)).toBe(true);
    const zooms = zoomsFromEvents(events, 10);
    expect(zooms).toHaveLength(1);
    const z = zooms[0]!;
    expect(z.srcStart).toBeGreaterThan(2); expect(z.srcStart).toBeLessThan(3);   // arrives as the menu opens at 3 s
    expect(z.srcEnd).toBeLessThanOrEqual(7.01);                                  // and doesn't run past the page change
    expect(z.x).toBeGreaterThan(0.65); expect(z.y).toBeLessThan(0.4);            // top right, where the menu is
    expect(z.scale).toBeGreaterThanOrEqual(1.25);
  }, 60_000);

  it("chains zooms that nearly touch so the camera pans between them", async () => {
    const { zoomsFromEvents } = await import("@/lib/services/local/activity");
    const ev = (t: number, x: number) => ({ t, x0: x, y0: 0.2, x1: x + 0.1, y1: 0.3, page: false });
    const z = zoomsFromEvents([ev(2, 0.1), ev(2.25, 0.1), ev(5, 0.8), ev(5.25, 0.8)], 20, { gap: 1 });
    expect(z).toHaveLength(2);
    expect(z[0]!.srcEnd - z[1]!.srcStart).toBeCloseTo(0.6); // overlap by the ease time
  });
});

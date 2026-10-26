import "server-only";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MODELS_DIR } from "./speech";
import { runFfmpeg } from "./ffmpeg";

/**
 * Finds personal data shown on screen in a recording, for Studio's automatic blur boxes.
 *   1. A frame every `everySec` seconds (JPEG, in a private temp folder, deleted afterwards).
 *   2. Text and its exact position read on this server with Tesseract (open source, Apache-2.0),
 *      only when the screen changed since the last frame read.
 *   3. Personal data picked out by fixed rules (email addresses, phone numbers, names from the
 *      app's own directory) and, only if a platform administrator switched it on, by Codex, which then
 *      receives the text lines read from the screen (never the picture).
 *   4. The same item on consecutive frames becomes one box over time. Boxes start one sample earlier
 *      and end one sample later than seen, so text appearing between two samples is still covered.
 * The result says what kind of data each box covers, never the text itself.
 */
export interface FoundBox { srcStart: number; srcEnd: number; x: number; y: number; w: number; h: number; label: string }
export interface ScreenLine { text: string; words: { text: string; x0: number; y0: number; x1: number; y1: number }[] }
/** Optional extra judge (Codex): for each line, the exact parts of it that are personal data. */
export type LineClassifier = (lines: string[]) => Promise<{ line: number; parts: string[] }[]>;

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE = /\+?\d[\d ().-]{7,}\d/g;

/** Matches in one line of text, as [start, end) character ranges, with their kind. */
export function ruleMatches(line: string, names: string[]): { start: number; end: number; label: string }[] {
  const out: { start: number; end: number; label: string }[] = [];
  for (const m of line.matchAll(EMAIL)) out.push({ start: m.index!, end: m.index! + m[0].length, label: "Email address" });
  for (const m of line.matchAll(PHONE)) if (m[0].replace(/\D/g, "").length >= 9) out.push({ start: m.index!, end: m.index! + m[0].length, label: "Phone number" });
  const lower = line.toLowerCase();
  for (const name of new Set(names.map((x) => x.trim().toLowerCase()).filter((x) => x.length >= 3))) {
    const n = name.toLowerCase();
    for (let i = lower.indexOf(n); i >= 0; i = lower.indexOf(n, i + n.length)) {
      const before = i === 0 || !/[a-z]/.test(lower[i - 1]!), after = i + n.length >= lower.length || !/[a-z]/.test(lower[i + n.length]!);
      if (before && after) out.push({ start: i, end: i + n.length, label: "Name" });
    }
  }
  // One box per stretch of text: overlapping matches (a name inside an email address) merge, longest first.
  return out.sort((a, b) => b.end - b.start - (a.end - a.start)).filter((m, i, all) => !all.slice(0, i).some((k) => m.start < k.end && k.start < m.end));
}

/** The words of a line that a character range touches, as one padded box in pixels. */
export function rangeBox(l: ScreenLine, start: number, end: number): { x0: number; y0: number; x1: number; y1: number } | null {
  let pos = 0, box: { x0: number; y0: number; x1: number; y1: number } | null = null;
  for (const w of l.words) {
    const ws = pos, we = pos + w.text.length;
    if (we > start && ws < end) box = box ? { x0: Math.min(box.x0, w.x0), y0: Math.min(box.y0, w.y0), x1: Math.max(box.x1, w.x1), y1: Math.max(box.y1, w.y1) } : { ...w };
    pos = we + 1; // the line text joins words with one space
  }
  if (!box) return null;
  const ph = (box.y1 - box.y0) * 0.35, pw = (box.y1 - box.y0) * 0.4;
  return { x0: box.x0 - pw, y0: box.y0 - ph, x1: box.x1 + pw, y1: box.y1 + ph };
}

const iou = (a: FoundBox, b: FoundBox) => {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = x * y;
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
};

/** Joins per-frame detections into boxes over time (same kind, overlapping place, consecutive samples). */
export function trackDetections(frames: { t: number; boxes: Omit<FoundBox, "srcStart" | "srcEnd">[] }[], everySec: number, duration: number): FoundBox[] {
  type Track = FoundBox & { last: number };
  const done: Track[] = [];
  let open: Track[] = [];
  for (const f of frames) {
    const next: Track[] = [];
    for (const b of f.boxes) {
      const hit = open.find((o) => o.label === b.label && f.t - o.last <= everySec * 1.5 + 1e-6 && iou(o, { ...b, srcStart: 0, srcEnd: 0 }) > 0.3);
      if (hit) {
        open = open.filter((o) => o !== hit);
        // Grow to cover both positions (small shifts while typing or scrolling a little).
        const x0 = Math.min(hit.x, b.x), y0 = Math.min(hit.y, b.y), x1 = Math.max(hit.x + hit.w, b.x + b.w), y1 = Math.max(hit.y + hit.h, b.y + b.h);
        next.push({ ...hit, x: x0, y: y0, w: x1 - x0, h: y1 - y0, last: f.t });
      } else next.push({ ...b, srcStart: f.t, srcEnd: f.t, last: f.t });
    }
    done.push(...open);
    open = next;
  }
  done.push(...open);
  return done.map(({ last, ...b }) => ({ ...b, srcStart: Math.max(0, b.srcStart - everySec), srcEnd: Math.min(duration, last + everySec) }));
}

type OcrWorker = { recognize(img: Buffer, o: object, out: object): Promise<{ data: { blocks?: { paragraphs: { lines: { words: { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }[] }[] }[] }[] | null } }>; terminate(): Promise<unknown> };

export async function detectScreenPii(filePath: string, o: {
  durationSec: number; width: number; height: number; names: string[]; classify?: LineClassifier; everySec?: number; onProgress?: (done: number, total: number) => Promise<void> | void;
}): Promise<FoundBox[]> {
  const every = o.everySec ?? 2;
  const dir = await mkdtemp(path.join(os.tmpdir(), "elks-pii-"));
  const { createWorker } = await import("tesseract.js");
  const worker = (await createWorker("eng", 1, { cachePath: path.join(MODELS_DIR, "tesseract") })) as unknown as OcrWorker;
  try {
    await runFfmpeg(["-i", filePath, "-vf", `fps=1/${every}`, "-q:v", "3", path.join(dir, "f-%06d.jpg")]);
    const files = (await readdir(dir)).filter((f) => f.endsWith(".jpg")).sort();
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const thumb = createCanvas(64, 36), tg = thumb.getContext("2d");
    let prevThumb: Uint8ClampedArray | null = null, prevLines: ScreenLine[] = [];
    const perFrame: { t: number; lines: ScreenLine[] }[] = [];
    for (const [k, f] of files.entries()) {
      const img = await readFile(path.join(dir, f));
      // Skip reading text when the screen hasn't visibly changed: reuse the last frame's lines.
      tg.drawImage(await loadImage(img), 0, 0, 64, 36);
      const px = tg.getImageData(0, 0, 64, 36).data;
      let diff = Infinity;
      if (prevThumb) { diff = 0; for (let i = 0; i < px.length; i += 4) diff += Math.abs(px[i]! - prevThumb[i]!); diff /= px.length / 4; }
      let lines = prevLines;
      if (diff > 1.5) {
        const { data } = await worker.recognize(img, {}, { blocks: true });
        lines = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.map((l) => {
          const words = l.words.filter((w) => w.text.trim()).map((w) => ({ text: w.text.trim(), ...w.bbox }));
          return { text: words.map((w) => w.text).join(" "), words };
        }))).filter((l) => l.words.length);
        prevThumb = new Uint8ClampedArray(px); prevLines = lines;
      }
      perFrame.push({ t: k * every, lines });
      await o.onProgress?.(k + 1, files.length);
    }

    // Optional second judge for names, addresses and IDs that rules can't recognise.
    const extra = new Map<string, string[]>();
    if (o.classify) {
      const unique = [...new Set(perFrame.flatMap((f) => f.lines.map((l) => l.text)).filter((t) => t.length >= 3))];
      for (let i = 0; i < unique.length; i += 80) {
        const batch = unique.slice(i, i + 80);
        for (const r of await o.classify(batch)) if (batch[r.line]) extra.set(batch[r.line]!, r.parts);
      }
    }

    const frames = perFrame.map((f) => ({
      t: f.t,
      boxes: f.lines.flatMap((l) => {
        const hits = ruleMatches(l.text, o.names);
        // Codex's finds add to the rules' but never duplicate them: an overlapping find keeps the rule's label.
        for (const part of extra.get(l.text) ?? []) {
          const at = l.text.indexOf(part);
          if (at < 0 || !part.trim()) continue;
          const end = at + part.length;
          if (!hits.some((h) => at < h.end && h.start < end)) hits.push({ start: at, end, label: "Personal data" });
        }
        return hits.flatMap((h) => {
          const b = rangeBox(l, h.start, h.end);
          return b ? [{ x: b.x0 / o.width, y: b.y0 / o.height, w: (b.x1 - b.x0) / o.width, h: (b.y1 - b.y0) / o.height, label: h.label }] : [];
        });
      }),
    }));
    return trackDetections(frames, every, o.durationSec);
  } finally {
    await worker.terminate().catch(() => {});
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

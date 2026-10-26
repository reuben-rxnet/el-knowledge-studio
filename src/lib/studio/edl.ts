// Studio's edit list: a non-destructive description of the finished video. The original recording is
// never changed. The browser preview and the server renderer both read this same list, so what you
// see while editing is what the MP4 contains.
//
// Times are seconds. "Source time" is a position in the original recording; "output time" is a
// position in the edited video (after cuts, reordering and speed changes).
import { z } from "zod";

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 4, 8] as const;
export const MIN_CLIP_SEC = 0.2;
export const MIN_BLUR_SEC = 0.2;
export const FPS = 30;

/** A stretch of the source on the main track, played at `speed`. Clips play in list order. */
export interface Clip { id: string; srcIn: number; srcOut: number; speed: number }
/**
 * A blurred rectangle, anchored to the source so it stays on the right content after cuts and moves.
 * x, y, w, h are fractions of the video frame (0-1), so they don't depend on its resolution.
 */
export interface BlurBox { id: string; srcStart: number; srcEnd: number; x: number; y: number; w: number; h: number }
export interface Edl { v: 1; sourceDuration: number; clips: Clip[]; blurs: BlurBox[] }
export interface Cue { start: number; end: number; text: string }

const round = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function defaultEdl(sourceDuration: number, id = "c1"): Edl {
  return { v: 1, sourceDuration: round(sourceDuration), clips: [{ id, srcIn: 0, srcOut: round(sourceDuration), speed: 1 }], blurs: [] };
}

export const clipLength = (c: Clip) => (c.srcOut - c.srcIn) / c.speed;
export const outputDuration = (e: Edl) => e.clips.reduce((t, c) => t + clipLength(c), 0);

/** Output start time of each clip. */
export function clipStarts(e: Edl): number[] {
  const out: number[] = [];
  let t = 0;
  for (const c of e.clips) { out.push(t); t += clipLength(c); }
  return out;
}

/** Which clip plays at output time t, and the matching source time. */
export function locate(e: Edl, t: number): { index: number; srcTime: number } {
  const starts = clipStarts(e);
  const total = outputDuration(e);
  const at = clamp(t, 0, total);
  let i = starts.findIndex((s, k) => at >= s && at < s + clipLength(e.clips[k]!));
  if (i < 0) i = e.clips.length - 1; // the very end
  const c = e.clips[i]!;
  return { index: i, srcTime: clamp(c.srcIn + (at - starts[i]!) * c.speed, c.srcIn, c.srcOut) };
}

/** Where a stretch of the source appears in the output: one range per clip that shows part of it. */
export function toOutput(e: Edl, srcStart: number, srcEnd: number): { start: number; end: number; clip: number }[] {
  const starts = clipStarts(e);
  const out: { start: number; end: number; clip: number }[] = [];
  e.clips.forEach((c, i) => {
    const a = Math.max(srcStart, c.srcIn), b = Math.min(srcEnd, c.srcOut);
    if (b - a > 1e-6) out.push({ start: starts[i]! + (a - c.srcIn) / c.speed, end: starts[i]! + (b - c.srcIn) / c.speed, clip: i });
  });
  return out.sort((x, y) => x.start - y.start);
}

/** Caption cues on the output timeline. A sentence cut in half keeps only the part that's still shown. */
export function outputCues(e: Edl, segments: Cue[]): Cue[] {
  return segments.flatMap((s) => toOutput(e, s.start, s.end).map((r) => ({ start: r.start, end: r.end, text: s.text }))).sort((a, b) => a.start - b.start);
}

/** Cues for one clip, in that clip's own time (0 = the clip's first frame). Used to render a clip on its own. */
export function clipCues(e: Edl, index: number, segments: Cue[]): Cue[] {
  const c = e.clips[index]!;
  return segments.flatMap((s) => {
    const a = Math.max(s.start, c.srcIn), b = Math.min(s.end, c.srcOut);
    return b - a > 1e-6 ? [{ start: (a - c.srcIn) / c.speed, end: (b - c.srcIn) / c.speed, text: s.text }] : [];
  });
}

/** Blur boxes that touch one clip, with their times in that clip's own time. */
export function clipBlurs(e: Edl, index: number): (BlurBox & { start: number; end: number })[] {
  const c = e.clips[index]!;
  return e.blurs.flatMap((b) => {
    const a = Math.max(b.srcStart, c.srcIn), z = Math.min(b.srcEnd, c.srcOut);
    return z - a > 1e-6 ? [{ ...b, start: (a - c.srcIn) / c.speed, end: (z - c.srcIn) / c.speed }] : [];
  });
}

export const blursAt = (e: Edl, srcTime: number) => e.blurs.filter((b) => srcTime >= b.srcStart && srcTime < b.srcEnd);

// --- Edits. Each returns a new list (the editor keeps old ones for undo). ---------------------------

/** Splits the clip under output time t into two. No-op within MIN_CLIP_SEC of a clip edge. */
export function splitAt(e: Edl, t: number, newId: string): Edl {
  const { index, srcTime } = locate(e, t);
  const c = e.clips[index]!;
  if (srcTime - c.srcIn < MIN_CLIP_SEC || c.srcOut - srcTime < MIN_CLIP_SEC) return e;
  const s = round(srcTime);
  const clips = [...e.clips];
  clips.splice(index, 1, { ...c, srcOut: s }, { ...c, id: newId, srcIn: s });
  return { ...e, clips };
}

/** Deletes a clip. The last remaining clip can't be deleted. */
export function removeClip(e: Edl, index: number): Edl {
  if (e.clips.length <= 1 || !e.clips[index]) return e;
  return { ...e, clips: e.clips.filter((_, i) => i !== index) };
}

export function moveClip(e: Edl, index: number, to: number): Edl {
  if (!e.clips[index] || to < 0 || to >= e.clips.length || to === index) return e;
  const clips = [...e.clips];
  const [c] = clips.splice(index, 1);
  clips.splice(to, 0, c!);
  return { ...e, clips };
}

export function setSpeed(e: Edl, index: number, speed: number): Edl {
  if (!e.clips[index] || !(SPEEDS as readonly number[]).includes(speed)) return e;
  return { ...e, clips: e.clips.map((c, i) => (i === index ? { ...c, speed } : c)) };
}

/** Moves a clip's start and/or end in the source, kept inside the recording and at least MIN_CLIP_SEC long. */
export function trimClip(e: Edl, index: number, edge: { srcIn?: number; srcOut?: number }): Edl {
  const c = e.clips[index];
  if (!c) return e;
  let srcIn = edge.srcIn ?? c.srcIn, srcOut = edge.srcOut ?? c.srcOut;
  srcIn = clamp(srcIn, 0, e.sourceDuration - MIN_CLIP_SEC);
  srcOut = clamp(srcOut, MIN_CLIP_SEC, e.sourceDuration);
  if (srcOut - srcIn < MIN_CLIP_SEC) { if (edge.srcIn !== undefined) srcIn = srcOut - MIN_CLIP_SEC; else srcOut = srcIn + MIN_CLIP_SEC; }
  return { ...e, clips: e.clips.map((x, i) => (i === index ? { ...x, srcIn: round(srcIn), srcOut: round(srcOut) } : x)) };
}

function fitBlur(e: Edl, b: BlurBox): BlurBox {
  const w = clamp(b.w, 0.02, 1), h = clamp(b.h, 0.02, 1);
  let srcStart = clamp(b.srcStart, 0, e.sourceDuration - MIN_BLUR_SEC);
  const srcEnd = clamp(b.srcEnd, srcStart + MIN_BLUR_SEC, e.sourceDuration);
  if (srcEnd - srcStart < MIN_BLUR_SEC) srcStart = srcEnd - MIN_BLUR_SEC;
  return { ...b, srcStart: round(srcStart), srcEnd: round(srcEnd), w: round(w), h: round(h), x: round(clamp(b.x, 0, 1 - w)), y: round(clamp(b.y, 0, 1 - h)) };
}

/** Adds a blur box at output time t: centred, 5 seconds long (or to the end of the clip). */
export function addBlur(e: Edl, t: number, id: string): Edl {
  const { index, srcTime } = locate(e, t);
  const c = e.clips[index]!;
  const end = Math.min(c.srcOut, srcTime + 5 * c.speed);
  return { ...e, blurs: [...e.blurs, fitBlur(e, { id, srcStart: srcTime, srcEnd: Math.max(end, srcTime + MIN_BLUR_SEC), x: 0.35, y: 0.4, w: 0.3, h: 0.15 })] };
}

export function updateBlur(e: Edl, id: string, patch: Partial<Omit<BlurBox, "id">>): Edl {
  return { ...e, blurs: e.blurs.map((b) => (b.id === id ? fitBlur(e, { ...b, ...patch }) : b)) };
}

export const removeBlur = (e: Edl, id: string): Edl => ({ ...e, blurs: e.blurs.filter((b) => b.id !== id) });

// --- Validation (the server never trusts the browser's list) ------------------------------------

const id = z.string().regex(/^[\w-]{1,40}$/);
const sec = z.number().finite().min(0);
export const edlSchema = z.object({
  v: z.literal(1),
  sourceDuration: z.number().positive(),
  clips: z.array(z.object({ id, srcIn: sec, srcOut: sec, speed: z.number().refine((s) => (SPEEDS as readonly number[]).includes(s), "Unsupported speed.") })).min(1).max(500),
  blurs: z.array(z.object({ id, srcStart: sec, srcEnd: sec, x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0.01).max(1), h: z.number().min(0.01).max(1) })).max(500),
});

/** Checks a list against the real recording length. Returns a problem in plain words, or null. */
export function edlProblem(e: Edl, sourceDuration: number): string | null {
  const tolerance = 0.05;
  for (const [i, c] of e.clips.entries()) {
    if (c.srcOut - c.srcIn < MIN_CLIP_SEC - 1e-6) return `Clip ${i + 1} is too short.`;
    if (c.srcOut > sourceDuration + tolerance) return `Clip ${i + 1} ends after the recording does.`;
  }
  for (const [i, b] of e.blurs.entries()) {
    if (b.srcEnd <= b.srcStart) return `Blur ${i + 1} ends before it starts.`;
    if (b.x + b.w > 1 + 1e-6 || b.y + b.h > 1 + 1e-6) return `Blur ${i + 1} goes outside the frame.`;
  }
  if (outputDuration(e) < 1) return "The edited video must be at least 1 second long.";
  return null;
}

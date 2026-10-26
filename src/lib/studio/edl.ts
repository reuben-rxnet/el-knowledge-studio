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
export interface BlurBox {
  id: string; srcStart: number; srcEnd: number; x: number; y: number; w: number; h: number;
  /** Set on boxes found by personal-data detection: what was found ("Email address"), never the text itself. */
  label?: string;
  auto?: boolean;
}
export const ANNOTATION_KINDS = ["box", "arrow", "text", "badge", "spotlight"] as const;
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number];
export const ANNOTATION_COLORS = { red: "#E53935", yellow: "#FFC83D", blue: "#1E88E5", white: "#FFFFFF" } as const;
export type AnnotationColor = keyof typeof ANNOTATION_COLORS;
/**
 * Drawn on top of the video, anchored to the source like blur boxes. Box, text, badge and spotlight
 * use the rectangle x, y, w, h (fractions of the frame); an arrow runs from (x, y) to (x + w, y + h).
 */
export interface Annotation { id: string; kind: AnnotationKind; srcStart: number; srcEnd: number; x: number; y: number; w: number; h: number; text: string; color: AnnotationColor }
export interface AudioOptions { denoise: boolean; normalize: boolean }
/**
 * A zoom: from srcStart to srcEnd the picture moves in to `scale` (1.1-4) around (x, y), the focus point
 * as fractions of the frame. It eases in and out over ZOOM_RAMP_SEC of source time. Found zooms
 * (`auto`) come from changes on screen; running the detection again replaces only those.
 */
export interface Zoom { id: string; srcStart: number; srcEnd: number; x: number; y: number; scale: number; auto?: boolean }
/** A named point in the recording; becomes a chapter in the MP4 and in the published guide. */
export interface Chapter { id: string; srcTime: number; title: string }
export const ASPECTS = ["16:9", "1:1", "9:16"] as const;
export type Aspect = (typeof ASPECTS)[number];
/** fit: the whole screen, with bars where the shapes differ. fill: the frame is filled and follows the zooms. */
export interface OutputOptions { aspect: Aspect; fit: "fit" | "fill" }
/** `track` is a music library id (built in, or uploaded by a brand administrator). */
export interface MusicOptions { track: string | null; volume: number; duck: boolean }
/** The brand template (set in Brand Center) decides how these look; the edit decides whether they appear. */
export interface BrandOptions { intro: boolean; outro: boolean; lowerThird: boolean }
/** AI voice reads the script instead of the recorded narration (Kokoro, on this server). */
export interface VoiceOptions { ai: boolean; voice: string }
export interface Edl {
  v: 1; sourceDuration: number; clips: Clip[]; blurs: BlurBox[]; annotations: Annotation[]; audio: AudioOptions;
  zooms: Zoom[]; chapters: Chapter[]; output: OutputOptions; music: MusicOptions; brand: BrandOptions; voice: VoiceOptions;
  /** Caption language: the project's language or one of its translations. null = the project's language. */
  captionLanguage: string | null;
}
/** A caption. `ref` is the script paragraph it shows, so a translation can replace its text. */
export interface Cue { start: number; end: number; text: string; ref?: string }
/** A spoken word with its time in the source (from Whisper's word timestamps). */
export interface Word { text: string; start: number; end: number }

const round = (n: number) => Math.round(n * 1000) / 1000;
export const EDL_DEFAULTS = {
  zooms: [] as Zoom[], chapters: [] as Chapter[], output: { aspect: "16:9", fit: "fit" } as OutputOptions,
  music: { track: null, volume: 0.25, duck: true } as MusicOptions, brand: { intro: false, outro: false, lowerThird: false } as BrandOptions,
  voice: { ai: false, voice: "bf_emma" } as VoiceOptions, captionLanguage: null as string | null,
};
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function defaultEdl(sourceDuration: number, id = "c1"): Edl {
  return { v: 1, sourceDuration: round(sourceDuration), clips: [{ id, srcIn: 0, srcOut: round(sourceDuration), speed: 1 }], blurs: [], annotations: [], audio: { denoise: false, normalize: false }, ...EDL_DEFAULTS };
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

/** Replaces the automatically found blur boxes with a new set; boxes drawn by hand stay. */
export const replaceAutoBlurs = (e: Edl, found: BlurBox[]): Edl => ({ ...e, blurs: [...e.blurs.filter((b) => !b.auto), ...found.map((b) => fitBlur(e, { ...b, auto: true }))] });

// --- Editing by text ------------------------------------------------------------------------------

/**
 * Removes a stretch of the recording from every clip that shows it: a clip wholly inside is dropped,
 * one that overlaps is shortened, one that contains it is split in two. This is what deleting words does.
 */
export function cutSource(e: Edl, srcStart: number, srcEnd: number, newId: () => string): Edl {
  if (srcEnd - srcStart <= 1e-6) return e;
  const clips = e.clips.flatMap((c) => {
    if (srcEnd <= c.srcIn || srcStart >= c.srcOut) return [c];
    const keep: Clip[] = [];
    if (srcStart - c.srcIn >= MIN_CLIP_SEC) keep.push({ ...c, srcOut: round(srcStart) });
    if (c.srcOut - srcEnd >= MIN_CLIP_SEC) keep.push({ ...c, id: keep.length ? newId() : c.id, srcIn: round(srcEnd) });
    return keep;
  });
  return clips.length ? { ...e, clips } : e; // never cut everything
}

/** Is this moment of the recording in the edited video? */
export const isShown = (e: Edl, srcTime: number) => e.clips.some((c) => srcTime >= c.srcIn && srcTime < c.srcOut);

const FILLERS = new Set(["um", "umm", "uh", "uhm", "uhh", "er", "erm", "ah", "hmm", "mm", "mhm"]);
export const isFiller = (w: Word) => FILLERS.has(w.text.toLowerCase().replace(/[^a-z]/g, ""));

/**
 * Stretches to cut for "tidy up": filler words (um, uh...) and pauses longer than `pauseSec`, keeping
 * `keepSec` of each pause so speech doesn't run together. Only what is still in the video counts.
 */
export function tidyCuts(e: Edl, words: Word[], o: { fillers: boolean; pauseSec: number | null; keepSec?: number }): { start: number; end: number; kind: "filler" | "pause" }[] {
  const keep = o.keepSec ?? 0.35;
  const shown = words.filter((w) => isShown(e, (w.start + w.end) / 2)).sort((a, b) => a.start - b.start);
  const cuts: { start: number; end: number; kind: "filler" | "pause" }[] = [];
  if (o.fillers) for (const w of shown) if (isFiller(w)) cuts.push({ start: w.start, end: w.end, kind: "filler" });
  if (o.pauseSec !== null) {
    for (let i = 1; i < shown.length; i++) {
      const gap = shown[i]!.start - shown[i - 1]!.end;
      if (gap > o.pauseSec) cuts.push({ start: shown[i - 1]!.end + keep / 2, end: shown[i]!.start - keep / 2, kind: "pause" });
    }
  }
  return cuts.filter((c) => c.end - c.start > 0.05).sort((a, b) => a.start - b.start);
}

// --- Annotations ----------------------------------------------------------------------------------

const ANNOTATION_SIZE: Record<AnnotationKind, { w: number; h: number }> = {
  box: { w: 0.3, h: 0.15 }, spotlight: { w: 0.35, h: 0.25 }, text: { w: 0.4, h: 0.08 }, badge: { w: 0.05, h: 0.09 }, arrow: { w: 0.12, h: 0.12 },
};

function fitAnnotation(e: Edl, a: Annotation): Annotation {
  let srcStart = clamp(a.srcStart, 0, e.sourceDuration - MIN_BLUR_SEC);
  const srcEnd = clamp(a.srcEnd, srcStart + MIN_BLUR_SEC, e.sourceDuration);
  if (srcEnd - srcStart < MIN_BLUR_SEC) srcStart = srcEnd - MIN_BLUR_SEC;
  const base = { ...a, srcStart: round(srcStart), srcEnd: round(srcEnd), text: a.text.slice(0, 120) };
  if (a.kind === "arrow") {
    // Both ends stay inside the frame; the arrow keeps a visible length.
    const x = clamp(a.x, 0, 1), y = clamp(a.y, 0, 1);
    return { ...base, x: round(x), y: round(y), w: round(clamp(x + a.w, 0, 1) - x), h: round(clamp(y + a.h, 0, 1) - y) };
  }
  const w = clamp(a.w, 0.02, 1), h = clamp(a.h, 0.02, 1);
  return { ...base, w: round(w), h: round(h), x: round(clamp(a.x, 0, 1 - w)), y: round(clamp(a.y, 0, 1 - h)) };
}

/** Adds an annotation at output time t, 4 seconds long (or to the end of the clip). */
export function addAnnotation(e: Edl, t: number, kind: AnnotationKind, id: string, text = ""): Edl {
  const { index, srcTime } = locate(e, t);
  const c = e.clips[index]!;
  const { w, h } = ANNOTATION_SIZE[kind];
  const defaults = { box: "", spotlight: "", arrow: "", badge: String(e.annotations.filter((a) => a.kind === "badge").length + 1), text: "Add your text" };
  const a: Annotation = { id, kind, srcStart: srcTime, srcEnd: Math.max(Math.min(c.srcOut, srcTime + 4 * c.speed), srcTime + MIN_BLUR_SEC), x: 0.5 - w / 2, y: 0.4, w, h, text: text || defaults[kind], color: kind === "spotlight" ? "white" : kind === "text" ? "white" : "red" };
  return { ...e, annotations: [...e.annotations, fitAnnotation(e, a)] };
}

export function updateAnnotation(e: Edl, id: string, patch: Partial<Omit<Annotation, "id" | "kind">>): Edl {
  return { ...e, annotations: e.annotations.map((a) => (a.id === id ? fitAnnotation(e, { ...a, ...patch }) : a)) };
}
export const removeAnnotation = (e: Edl, id: string): Edl => ({ ...e, annotations: e.annotations.filter((a) => a.id !== id) });
export const annotationsAt = (e: Edl, srcTime: number) => e.annotations.filter((a) => srcTime >= a.srcStart && srcTime < a.srcEnd);

/** Annotations that touch one clip, with their times in that clip's own time. */
export function clipAnnotations(e: Edl, index: number): (Annotation & { start: number; end: number })[] {
  const c = e.clips[index]!;
  return e.annotations.flatMap((a) => {
    const s = Math.max(a.srcStart, c.srcIn), z = Math.min(a.srcEnd, c.srcOut);
    return z - s > 1e-6 ? [{ ...a, start: (s - c.srcIn) / c.speed, end: (z - c.srcIn) / c.speed }] : [];
  });
}

export const setAudio = (e: Edl, patch: Partial<AudioOptions>): Edl => ({ ...e, audio: { ...e.audio, ...patch } });

// --- Zooms ----------------------------------------------------------------------------------------

export const ZOOM_RAMP_SEC = 0.6;
export const ZOOM_SCALES = [1.25, 1.5, 1.75, 2, 2.5, 3] as const;
const MIN_ZOOM_SEC = 0.8;

function fitZoom(e: Edl, z: Zoom): Zoom {
  let srcStart = clamp(z.srcStart, 0, Math.max(0, e.sourceDuration - MIN_ZOOM_SEC));
  const srcEnd = clamp(z.srcEnd, srcStart + MIN_ZOOM_SEC, e.sourceDuration);
  if (srcEnd - srcStart < MIN_ZOOM_SEC) srcStart = Math.max(0, srcEnd - MIN_ZOOM_SEC);
  return { ...z, srcStart: round(srcStart), srcEnd: round(srcEnd), x: round(clamp(z.x, 0, 1)), y: round(clamp(z.y, 0, 1)), scale: round(clamp(z.scale, 1.1, 4)) };
}

/** Adds a 3-second 2x zoom at output time t, centred (then move its focus on the video). */
export function addZoom(e: Edl, t: number, id: string): Edl {
  const { index, srcTime } = locate(e, t);
  const c = e.clips[index]!;
  return { ...e, zooms: [...e.zooms, fitZoom(e, { id, srcStart: srcTime, srcEnd: srcTime + Math.max(3 * c.speed, MIN_ZOOM_SEC), x: 0.5, y: 0.5, scale: 2 })].sort((a, b) => a.srcStart - b.srcStart) };
}
export function updateZoom(e: Edl, id: string, patch: Partial<Omit<Zoom, "id">>): Edl {
  return { ...e, zooms: e.zooms.map((z) => (z.id === id ? fitZoom(e, { ...z, ...patch }) : z)) };
}
export const removeZoom = (e: Edl, id: string): Edl => ({ ...e, zooms: e.zooms.filter((z) => z.id !== id) });
/** Replaces the found zooms with a new set; zooms added by hand stay. */
export const replaceAutoZooms = (e: Edl, found: Zoom[]): Edl =>
  ({ ...e, zooms: [...e.zooms.filter((z) => !z.auto), ...found.map((z) => fitZoom(e, { ...z, auto: true }))].sort((a, b) => a.srcStart - b.srcStart) });
export const zoomsAt = (e: Edl, srcTime: number) => e.zooms.filter((z) => srcTime >= z.srcStart && srcTime < z.srcEnd);

/** How far zoom `z` has eased in at source time t: 0 (not zoomed) to 1 (fully in), smoothstep both ways. */
export function zoomWeight(z: Zoom, t: number): number {
  const ease = (u: number) => { const v = clamp(u, 0, 1); return v * v * (3 - 2 * v); };
  return ease((t - z.srcStart) / ZOOM_RAMP_SEC) * ease((z.srcEnd - t) / ZOOM_RAMP_SEC);
}

/** Output frame size in pixels for each shape (16:9 is the size Studio always rendered). */
export const OUTPUT_SIZE: Record<Aspect, { w: number; h: number }> = { "16:9": { w: 1280, h: 720 }, "1:1": { w: 960, h: 960 }, "9:16": { w: 720, h: 1280 } };

/** The camera's base rectangle (fractions of the frame) before any zoom: the whole frame, or for "fill" the output's shape. */
export function baseView(e: Edl, srcAspect: number): { bw: number; bh: number } {
  const outAspect = OUTPUT_SIZE[e.output.aspect].w / OUTPUT_SIZE[e.output.aspect].h;
  if (e.output.fit !== "fill") return { bw: 1, bh: 1 };
  return outAspect < srcAspect ? { bw: outAspect / srcAspect, bh: 1 } : { bw: 1, bh: srcAspect / outAspect };
}

/**
 * The part of the recording shown at source time t, as fractions of the frame: the "camera". With no
 * zoom and "fit" it is the whole frame; "fill" crops to the output's shape. A zoom shrinks the
 * rectangle by its scale around its focus point, kept inside the frame. Zooms that follow each other
 * closely blend (one eases out while the next eases in), so the camera pans instead of jumping.
 * The preview and the renderer both use this, so they show the same thing.
 */
export function viewAt(e: Edl, t: number, srcAspect: number): { x: number; y: number; w: number; h: number; zoom: number } {
  const { bw, bh } = baseView(e, srcAspect);
  let zoom = 1, cx = 0.5, cy = 0.5;
  for (const z of e.zooms) {
    const w = zoomWeight(z, t);
    if (w <= 0) continue;
    zoom += w * (z.scale - 1); cx += w * (z.x - 0.5); cy += w * (z.y - 0.5);
  }
  zoom = clamp(zoom, 1, 4);
  const w = bw / zoom, h = bh / zoom;
  return { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h, zoom };
}

/** Zooms that touch one clip, with their times in that clip's own time. */
export function clipZooms(e: Edl, index: number): Zoom[] {
  const c = e.clips[index]!;
  return e.zooms.filter((z) => z.srcEnd > c.srcIn && z.srcStart < c.srcOut);
}

// --- Chapters -------------------------------------------------------------------------------------

const MIN_CHAPTER_SEC = 1;

export function addChapter(e: Edl, t: number, id: string, title = ""): Edl {
  const { srcTime } = locate(e, t);
  return { ...e, chapters: [...e.chapters, { id, srcTime: round(srcTime), title: (title || `Chapter ${e.chapters.length + 1}`).slice(0, 80) }].sort((a, b) => a.srcTime - b.srcTime) };
}
export function updateChapter(e: Edl, id: string, patch: Partial<Omit<Chapter, "id">>): Edl {
  return { ...e, chapters: e.chapters.map((c) => (c.id === id ? { ...c, title: (patch.title ?? c.title).slice(0, 80), srcTime: round(clamp(patch.srcTime ?? c.srcTime, 0, e.sourceDuration)) } : c)).sort((a, b) => a.srcTime - b.srcTime) };
}
export const removeChapter = (e: Edl, id: string): Edl => ({ ...e, chapters: e.chapters.filter((c) => c.id !== id) });
/** Replaces all chapters (e.g. with the suggested ones), in one undoable step. */
export const setChapters = (e: Edl, list: { srcTime: number; title: string }[], newId: () => string): Edl =>
  ({ ...e, chapters: list.map((c) => ({ id: newId(), srcTime: round(clamp(c.srcTime, 0, e.sourceDuration)), title: c.title.slice(0, 80) })).sort((a, b) => a.srcTime - b.srcTime) });

/**
 * Chapters on the output timeline, in order, each running to the next one. A chapter whose moment was
 * cut out is dropped; the first chapter starts at 0 (a video's first chapter must). `offset` shifts
 * them all (an intro card before the edit) without moving the first one off 0.
 */
export function outputChapters(e: Edl, offset = 0, extra = 0): { start: number; end: number; title: string }[] {
  const total = outputDuration(e);
  const at = e.chapters.flatMap((c) => { const r = toOutput(e, c.srcTime, c.srcTime + 0.01)[0]; return r ? [{ start: r.start, title: c.title }] : []; })
    .sort((a, b) => a.start - b.start)
    // Players can't show a chapter under a second long: one that starts with the previous is dropped.
    .filter((c, i, all) => i === 0 || c.start - all[i - 1]!.start >= MIN_CHAPTER_SEC);
  if (!at.length) return [];
  return at.map((c, i) => ({ start: i === 0 ? 0 : round(c.start + offset), end: round((at[i + 1]?.start ?? total + extra) + offset), title: c.title }));
}

export const setOptions = (e: Edl, patch: Partial<Pick<Edl, "output" | "music" | "brand" | "voice" | "captionLanguage">>): Edl => ({ ...e, ...patch });

// --- Validation (the server never trusts the browser's list) ------------------------------------

const id = z.string().regex(/^[\w-]{1,40}$/);
const sec = z.number().finite().min(0);
export const edlSchema = z.object({
  v: z.literal(1),
  sourceDuration: z.number().positive(),
  clips: z.array(z.object({ id, srcIn: sec, srcOut: sec, speed: z.number().refine((s) => (SPEEDS as readonly number[]).includes(s), "Unsupported speed.") })).min(1).max(500),
  blurs: z.array(z.object({ id, srcStart: sec, srcEnd: sec, x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0.01).max(1), h: z.number().min(0.01).max(1), label: z.string().max(40).optional(), auto: z.boolean().optional() })).max(2000),
  // Phase 1 lists have no annotations or audio options yet: they default to none / off.
  annotations: z.array(z.object({
    id, kind: z.enum(ANNOTATION_KINDS), srcStart: sec, srcEnd: sec,
    x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(-1).max(1), h: z.number().min(-1).max(1),
    text: z.string().max(120), color: z.enum(Object.keys(ANNOTATION_COLORS) as [AnnotationColor, ...AnnotationColor[]]),
  })).max(500).default([]),
  audio: z.object({ denoise: z.boolean(), normalize: z.boolean() }).default({ denoise: false, normalize: false }),
  // Phase 3: zooms, chapters, output shape, music, brand, AI voice, caption language. Older lists default.
  zooms: z.array(z.object({ id, srcStart: sec, srcEnd: sec, x: z.number().min(0).max(1), y: z.number().min(0).max(1), scale: z.number().min(1).max(4), auto: z.boolean().optional() })).max(1000).default([]),
  chapters: z.array(z.object({ id, srcTime: sec, title: z.string().max(80) })).max(200).default([]),
  output: z.object({ aspect: z.enum(ASPECTS), fit: z.enum(["fit", "fill"]) }).default({ aspect: "16:9", fit: "fit" }),
  music: z.object({ track: z.string().regex(/^[\w-]{1,60}$/).nullable(), volume: z.number().min(0).max(1), duck: z.boolean() }).default({ track: null, volume: 0.25, duck: true }),
  brand: z.object({ intro: z.boolean(), outro: z.boolean(), lowerThird: z.boolean() }).default({ intro: false, outro: false, lowerThird: false }),
  voice: z.object({ ai: z.boolean(), voice: z.string().regex(/^[a-z]{2}_[a-z]{2,20}$/) }).default({ ai: false, voice: "bf_emma" }),
  captionLanguage: z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/).nullable().default(null),
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
  for (const [i, z] of e.zooms.entries()) if (z.srcEnd <= z.srcStart) return `Zoom ${i + 1} ends before it starts.`;
  if (outputDuration(e) < 1) return "The edited video must be at least 1 second long.";
  return null;
}

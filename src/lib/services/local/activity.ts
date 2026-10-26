import "server-only";
import { spawn } from "node:child_process";
import { FFMPEG } from "./ffmpeg";

/**
 * Automatic zoom for screen recordings, from the picture alone. Browsers don't give a web page the
 * mouse position or clicks in other windows while sharing a screen, so instead of recording mouse
 * data Studio looks for what a click causes: a small area of the screen changing (a menu opening, a
 * field filling in, a dialog appearing). Works for every recording, including ones made before.
 *
 * The video is read at SAMPLE_FPS in a small greyscale copy; each frame is compared with the one
 * before on a grid. A change covering a small part of the screen is an "event" with a box; a change
 * covering most of it is a page change (no zoom across it). Nearby events become one zoom on their
 * combined box, starting a little before the first (so the camera arrives as the click happens).
 */
export const SAMPLE_FPS = 4;
const W = 320, H = 180, GX = 32, GY = 18;
const PIXEL_DELTA = 26;       // grey levels: below this a pixel counts as unchanged (compression noise)
const CELL_SHARE = 0.06;      // a grid cell is active when this share of its pixels changed
const MAX_LOCAL = 0.3;        // above this share of active cells, it's a page change, not a local one

export interface ActivityEvent { t: number; x0: number; y0: number; x1: number; y1: number; page: boolean }

/** Compares two greyscale frames on the grid: null when nothing changed, else the changed area (fractions). */
export function frameChange(a: Uint8Array, b: Uint8Array, w = W, h = H): Omit<ActivityEvent, "t"> | null {
  const cw = w / GX, ch = h / GY;
  const counts = new Uint16Array(GX * GY);
  for (let y = 0; y < h; y++) {
    const gy = Math.min(GY - 1, Math.floor(y / ch));
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (Math.abs(a[i]! - b[i]!) > PIXEL_DELTA) counts[gy * GX + Math.min(GX - 1, Math.floor(x / cw))]!++;
    }
  }
  const need = cw * ch * CELL_SHARE;
  let active = 0, x0 = GX, y0 = GY, x1 = -1, y1 = -1;
  for (let gy = 0; gy < GY; gy++) for (let gx = 0; gx < GX; gx++) {
    if (counts[gy * GX + gx]! < need) continue;
    active++;
    x0 = Math.min(x0, gx); y0 = Math.min(y0, gy); x1 = Math.max(x1, gx); y1 = Math.max(y1, gy);
  }
  if (!active) return null;
  // A lone active cell is usually the mouse pointer moving: not worth a zoom on its own.
  if (active === 1) return null;
  return { x0: x0 / GX, y0: y0 / GY, x1: (x1 + 1) / GX, y1: (y1 + 1) / GY, page: active / (GX * GY) > MAX_LOCAL };
}

export interface FoundZoom { srcStart: number; srcEnd: number; x: number; y: number; scale: number }

/**
 * Turns change events into zooms. Events less than `gap` seconds apart whose boxes are close join one
 * zoom; a page change ends it. Each zoom frames its combined box at about 60% of the view, between
 * 1.25x and 2.5x; one whose box is too big to be worth zooming is dropped. Zooms that nearly touch
 * overlap by the ease time, so the camera pans from one to the next instead of going out and in.
 */
export function zoomsFromEvents(events: ActivityEvent[], duration: number, o: { gap?: number; lead?: number; hold?: number; ramp?: number } = {}): FoundZoom[] {
  const gap = o.gap ?? 1.5, lead = o.lead ?? 0.7, hold = o.hold ?? 1.6, ramp = o.ramp ?? 0.6;
  type Group = { start: number; end: number; x0: number; y0: number; x1: number; y1: number };
  const groups: Group[] = [];
  let cur: Group | null = null;
  for (const ev of [...events].sort((a, b) => a.t - b.t)) {
    if (ev.page) { if (cur) groups.push(cur); cur = null; continue; }
    if (cur) {
      const ux0 = Math.min(cur.x0, ev.x0), uy0 = Math.min(cur.y0, ev.y0), ux1 = Math.max(cur.x1, ev.x1), uy1 = Math.max(cur.y1, ev.y1);
      const close = ev.t - cur.end <= gap && ux1 - ux0 <= 0.6 && uy1 - uy0 <= 0.6;
      if (close) { cur = { start: cur.start, end: ev.t, x0: ux0, y0: uy0, x1: ux1, y1: uy1 }; continue; }
      groups.push(cur);
    }
    cur = { start: ev.t, end: ev.t, x0: ev.x0, y0: ev.y0, x1: ev.x1, y1: ev.y1 };
  }
  if (cur) groups.push(cur);

  const zooms: FoundZoom[] = [];
  for (const g of groups) {
    const bw = g.x1 - g.x0, bh = g.y1 - g.y0;
    const scale = Math.min(2.5, Math.floor(Math.min(0.6 / Math.max(bw, 0.01), 0.6 / Math.max(bh, 0.01)) * 4) / 4);
    if (scale < 1.25) continue;
    const srcStart = Math.max(0, g.start - lead), srcEnd = Math.min(duration, g.end + hold);
    if (srcEnd - srcStart < 1.2) continue;
    zooms.push({ srcStart, srcEnd, x: (g.x0 + g.x1) / 2, y: (g.y0 + g.y1) / 2, scale });
  }
  // Chain zooms that nearly touch: the next one starts as this one starts easing out.
  for (let i = 1; i < zooms.length; i++) {
    const prev = zooms[i - 1]!, z = zooms[i]!;
    if (z.srcStart - prev.srcEnd < 1) { const meet = Math.max(prev.srcStart + 1, Math.min(prev.srcEnd, z.srcStart + ramp)); prev.srcEnd = meet; z.srcStart = meet - ramp; }
  }
  return zooms.map((z) => ({ ...z, srcStart: Math.round(z.srcStart * 1000) / 1000, srcEnd: Math.round(z.srcEnd * 1000) / 1000, x: Math.round(z.x * 1000) / 1000, y: Math.round(z.y * 1000) / 1000 }));
}

/** Reads the recording and returns the change events, streaming (memory stays at two small frames). */
export function detectActivity(filePath: string, onProgress?: (sec: number) => void | Promise<void>): Promise<ActivityEvent[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, ["-hide_banner", "-loglevel", "error", "-i", filePath, "-vf", `fps=${SAMPLE_FPS},scale=${W}:${H},format=gray`, "-f", "rawvideo", "pipe:1"], { windowsHide: true });
    const size = W * H;
    let buf = Buffer.alloc(0), prev: Uint8Array | null = null, n = 0;
    const events: ActivityEvent[] = [];
    child.stdout.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= size) {
        const frame = new Uint8Array(buf.subarray(0, size));
        buf = buf.subarray(size);
        const t = n / SAMPLE_FPS;
        if (prev) { const c = frameChange(prev, frame); if (c) events.push({ t, ...c }); }
        prev = frame;
        n++;
        if (n % (SAMPLE_FPS * 10) === 0) void onProgress?.(t);
      }
    });
    let err = "";
    child.stderr.on("data", (d: Buffer) => { err += d.toString(); });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(events) : reject(new Error(`The recording couldn't be read for zooms (${err.trim().split("\n").at(-1)?.slice(0, 120) ?? code}).`))));
  });
}

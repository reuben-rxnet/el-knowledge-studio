// The timeline's pictures: a filmstrip (one small frame every `step` seconds of the video Studio edits,
// tiled into one JPEG) and a waveform (one PNG for the whole sound). The server makes them once per
// video; the browser picks tiles from the same layout, so both sides agree on which frame is where.

export const STRIP_TILE = { w: 160, h: 90, cols: 10 } as const;
const MAX_TILES = 120;

/** Seconds between filmstrip frames: one per second, or fewer for long videos (at most 120 tiles). */
export const stripStep = (duration: number) => Math.max(1, duration / MAX_TILES);
export const stripCount = (duration: number) => Math.max(1, Math.min(MAX_TILES + 1, Math.floor(duration / stripStep(duration)) + 1));

/** The tile showing source time t: its column and row in the strip image. */
export function stripTile(duration: number, t: number): { col: number; row: number } {
  const i = Math.min(stripCount(duration) - 1, Math.max(0, Math.round(t / stripStep(duration))));
  return { col: i % STRIP_TILE.cols, row: Math.floor(i / STRIP_TILE.cols) };
}

export const WAVE_SIZE = { w: 3000, h: 120 } as const;

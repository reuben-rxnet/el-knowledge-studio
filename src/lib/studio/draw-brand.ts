// Draws the brand template's intro and outro cards and the lower third with the standard 2D canvas
// API, so the Brand Center and Studio previews (browser) and the MP4 (@napi-rs/canvas on the server)
// look the same. The logo is the approved EssilorLuxottica wordmark file, passed in as an image.
import { BRAND_ACCENTS, type BrandTemplate } from "./brand-template";
import type { Ctx } from "./draw-annotations";

type Gradient = { addColorStop(o: number, c: string): void };
export type BrandCtx = Ctx & {
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): Gradient;
  drawImage(img: unknown, x: number, y: number, w: number, h: number): void;
  globalAlpha: number;
};
/** The wordmark as a drawable image with its natural size (viewBox 620 x 90). */
export interface LogoImage { image: unknown; width: number; height: number }

const FONT = "Segoe UI, Arial, DejaVu Sans, sans-serif";
const NAVY = "#071A33", DEEP = "#0B2D5B";

/** Wraps text to lines no wider than maxW at the current font. At most maxLines; the last gets "…". */
function wrap(g: Ctx, text: string, maxW: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (g.measureText(next).width > maxW && line) { lines.push(line); line = w; } else line = next;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1]!;
    while (last.length > 1 && g.measureText(`${last}…`).width > maxW) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last.trimEnd()}…`;
  }
  return lines;
}

/** Intro (title, subtitle) or outro (the template's closing text) card filling a W x H frame. */
export function drawCard(g: BrandCtx, W: number, H: number, o: { kind: "intro" | "outro"; title: string; subtitle: string; template: BrandTemplate; logo: LogoImage | null }) {
  const accent = BRAND_ACCENTS[o.template.accent];
  const u = Math.min(W, H) / 720; // 1 at 720p; everything scales with the frame's short side
  g.save();
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, NAVY); bg.addColorStop(1, DEEP);
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.fillStyle = accent; g.fillRect(0, H - 10 * u, W, 10 * u);
  const left = 80 * u, maxW = W - 2 * left;
  g.textAlign = "left"; g.textBaseline = "alphabetic";
  let y = H * (H > W ? 0.36 : 0.34);
  if (o.kind === "intro") {
    if (o.template.introKicker) {
      g.fillStyle = accent; g.font = `600 ${Math.round(26 * u)}px ${FONT}`;
      g.fillText(o.template.introKicker, left, y); y += 70 * u;
    }
    g.fillStyle = "#FFFFFF"; g.font = `700 ${Math.round(58 * u)}px ${FONT}`;
    for (const l of wrap(g, o.title, maxW, 3)) { g.fillText(l, left, y); y += 70 * u; }
    if (o.subtitle) { g.fillStyle = "#C8D7EA"; g.font = `400 ${Math.round(28 * u)}px ${FONT}`; y += 10 * u; for (const l of wrap(g, o.subtitle, maxW, 2)) { g.fillText(l, left, y); y += 40 * u; } }
  } else {
    g.fillStyle = "#FFFFFF"; g.font = `700 ${Math.round(46 * u)}px ${FONT}`;
    for (const l of wrap(g, o.template.outroText || o.title, maxW, 3)) { g.fillText(l, left, y); y += 60 * u; }
    if (o.subtitle) { g.fillStyle = "#C8D7EA"; g.font = `400 ${Math.round(26 * u)}px ${FONT}`; y += 14 * u; for (const l of wrap(g, o.subtitle, maxW, 2)) { g.fillText(l, left, y); y += 38 * u; } }
  }
  if (o.template.showLogo && o.logo) {
    const lh = 34 * u, lw = (o.logo.width / o.logo.height) * lh;
    g.drawImage(o.logo.image, left, H - 40 * u - 10 * u - lh, lw, lh);
  }
  g.restore();
}

/** Title and subtitle on a band at the bottom left, over the video (transparent elsewhere). */
export function drawLowerThird(g: BrandCtx, W: number, H: number, o: { title: string; subtitle: string; template: BrandTemplate }) {
  const accent = BRAND_ACCENTS[o.template.accent];
  const u = Math.min(W, H) / 720;
  const pad = 18 * u, x = 40 * u, maxW = Math.min(W - 2 * x, 760 * u) - 2 * pad - 8 * u;
  g.save();
  g.textAlign = "left"; g.textBaseline = "alphabetic";
  g.font = `700 ${Math.round(30 * u)}px ${FONT}`;
  const title = wrap(g, o.title, maxW, 2);
  g.font = `400 ${Math.round(22 * u)}px ${FONT}`;
  const sub = o.subtitle ? wrap(g, o.subtitle, maxW, 1) : [];
  const h = pad * 2 + title.length * 38 * u + sub.length * 30 * u;
  const widths = [...title.map((l) => { g.font = `700 ${Math.round(30 * u)}px ${FONT}`; return g.measureText(l).width; }), ...sub.map((l) => { g.font = `400 ${Math.round(22 * u)}px ${FONT}`; return g.measureText(l).width; })];
  const w = Math.max(...widths, 120 * u) + pad * 2 + 8 * u;
  // Above the captions, which sit at the bottom (higher in a tall frame, where they run to more lines).
  const y = H - (H > W ? 300 : 200) * u - h;
  g.globalAlpha = 0.92; g.fillStyle = NAVY; g.fillRect(x, y, w, h);
  g.globalAlpha = 1; g.fillStyle = accent; g.fillRect(x, y, 8 * u, h);
  let ty = y + pad + 30 * u;
  g.fillStyle = "#FFFFFF"; g.font = `700 ${Math.round(30 * u)}px ${FONT}`;
  for (const l of title) { g.fillText(l, x + 8 * u + pad, ty); ty += 38 * u; }
  g.fillStyle = "#C8D7EA"; g.font = `400 ${Math.round(22 * u)}px ${FONT}`;
  for (const l of sub) { g.fillText(l, x + 8 * u + pad, ty - 6 * u); ty += 30 * u; }
  g.restore();
}

/** The approved wordmark file in a given colour: its fill is `currentColor`, so the colour is set, not drawn. */
export const logoSvg = (file: string, color: string) => file.replace(/<svg\b/, `<svg width="620" height="90" color="${color}"`).replace(/currentColor/g, color);

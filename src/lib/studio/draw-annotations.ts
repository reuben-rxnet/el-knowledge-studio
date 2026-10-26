// Draws Studio annotations with the standard 2D canvas API. The browser preview and the server
// render (through @napi-rs/canvas, rasterised to a transparent PNG and overlaid by FFmpeg) both call
// this same function, so an arrow or a callout looks the same in the editor and in the MP4.
import { ANNOTATION_COLORS, type Annotation } from "./edl";

/** The part of CanvasRenderingContext2D used here (the browser's and @napi-rs/canvas's both fit). */
export interface Ctx {
  save(): void; restore(): void; beginPath(): void; closePath(): void; fill(): void; stroke(): void;
  moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; arc(x: number, y: number, r: number, a0: number, a1: number): void;
  rect(x: number, y: number, w: number, h: number): void; fillRect(x: number, y: number, w: number, h: number): void;
  fillText(t: string, x: number, y: number): void; measureText(t: string): { width: number };
  fillStyle: unknown; strokeStyle: unknown; lineWidth: number; lineJoin: unknown; lineCap: unknown; font: string; textAlign: unknown; textBaseline: unknown;
  shadowColor: string; shadowBlur: number; globalCompositeOperation: unknown;
}

const FONT = "Segoe UI, Arial, DejaVu Sans, sans-serif";

function roundRect(g: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y); g.lineTo(x + w - rr, y); g.arc(x + w - rr, y + rr, rr, -Math.PI / 2, 0);
  g.lineTo(x + w, y + h - rr); g.arc(x + w - rr, y + h - rr, rr, 0, Math.PI / 2);
  g.lineTo(x + rr, y + h); g.arc(x + rr, y + h - rr, rr, Math.PI / 2, Math.PI);
  g.lineTo(x, y + rr); g.arc(x + rr, y + rr, rr, Math.PI, Math.PI * 1.5);
  g.closePath();
}

/** Largest font size (px) at which `text` fits `maxW` on one line, starting from `size`. */
function fit(g: Ctx, text: string, size: number, maxW: number, weight: string) {
  let s = size;
  for (; s > 8; s -= 1) { g.font = `${weight} ${s}px ${FONT}`; if (g.measureText(text).width <= maxW) break; }
  return s;
}

/** Draws one annotation on a W x H frame. */
export function drawAnnotation(g: Ctx, a: Annotation, W: number, H: number) {
  const color = ANNOTATION_COLORS[a.color];
  const x = a.x * W, y = a.y * H, w = a.w * W, h = a.h * H;
  const line = Math.max(3, Math.round(H * 0.006));
  g.save();
  g.lineJoin = "round"; g.lineCap = "round";
  if (a.kind === "spotlight") {
    // Dim everything except the rectangle.
    g.fillStyle = "rgba(0,0,0,0.55)";
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = "destination-out";
    g.fillStyle = "#000";
    roundRect(g, x, y, w, h, line * 2); g.fill();
    g.globalCompositeOperation = "source-over";
    g.strokeStyle = color; g.lineWidth = Math.max(2, line / 2);
    roundRect(g, x, y, w, h, line * 2); g.stroke();
  } else if (a.kind === "box") {
    g.shadowColor = "rgba(0,0,0,0.45)"; g.shadowBlur = line * 2;
    g.strokeStyle = color; g.lineWidth = line;
    roundRect(g, x, y, w, h, line * 2); g.stroke();
  } else if (a.kind === "arrow") {
    const x2 = x + w, y2 = y + h, len = Math.hypot(w, h) || 1, ux = w / len, uy = h / len;
    const head = Math.max(line * 5, H * 0.03);
    g.shadowColor = "rgba(0,0,0,0.45)"; g.shadowBlur = line * 2;
    g.strokeStyle = color; g.fillStyle = color; g.lineWidth = line * 1.4;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x2 - ux * head * 0.8, y2 - uy * head * 0.8); g.stroke();
    g.beginPath(); g.moveTo(x2, y2);
    g.lineTo(x2 - ux * head - uy * head * 0.55, y2 - uy * head + ux * head * 0.55);
    g.lineTo(x2 - ux * head + uy * head * 0.55, y2 - uy * head - ux * head * 0.55);
    g.closePath(); g.fill();
  } else if (a.kind === "badge") {
    const r = Math.min(w, h) / 2, cx = x + w / 2, cy = y + h / 2;
    g.shadowColor = "rgba(0,0,0,0.45)"; g.shadowBlur = line * 2;
    g.fillStyle = color; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
    const label = a.text.slice(0, 3) || "1";
    fit(g, label, Math.round(r * 1.2), r * 1.6, "700");
    g.fillStyle = a.color === "white" || a.color === "yellow" ? "#111" : "#fff";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(label, cx, cy + r * 0.04);
  } else {
    // Text callout: a rounded label; dark with white text, or the chosen colour with contrasting text.
    const pad = h * 0.18;
    const bg = a.color === "white" ? "rgba(7,26,51,0.88)" : color;
    g.shadowColor = "rgba(0,0,0,0.35)"; g.shadowBlur = line * 2;
    g.fillStyle = bg; roundRect(g, x, y, w, h, h * 0.22); g.fill();
    g.shadowBlur = 0;
    fit(g, a.text, Math.round(h * 0.55), w - pad * 2, "600");
    g.fillStyle = a.color === "yellow" ? "#111" : "#fff";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(a.text, x + w / 2, y + h / 2 + h * 0.03);
  }
  g.restore();
}

/** Spotlights first (they dim the frame), then everything else on top, in the order added. Preview and render both use it. */
export const byDrawOrder = <T extends Pick<Annotation, "kind">>(list: T[]) => [...list.filter((a) => a.kind === "spotlight"), ...list.filter((a) => a.kind !== "spotlight")];

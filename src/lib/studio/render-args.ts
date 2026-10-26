// FFmpeg arguments for Studio renders. Each clip is rendered to its own segment (accurate seek,
// re-encoded, so cuts land on the exact frame), then the segments are joined without re-encoding.
// Rendering clip by clip keeps memory flat however long the recording is.
import { clipBlurs, FPS, type Edl } from "./edl";

export const OUT_W = 1280, OUT_H = 720;
const CAPTION_STYLE = "FontName=Segoe UI,FontSize=20,PrimaryColour=&H00FFFFFF,BackColour=&H80000000,BorderStyle=4,Outline=0,MarginV=28";
const n = (x: number) => (Math.round(x * 1000) / 1000).toString();

/** atempo only takes 0.5-2 per filter, so 4x is 2x then 2x. */
export function atempoChain(speed: number): string[] {
  const out: string[] = [];
  let s = speed;
  while (s > 2 + 1e-9) { out.push("atempo=2"); s /= 2; }
  while (s < 0.5 - 1e-9) { out.push("atempo=0.5"); s /= 0.5; }
  if (Math.abs(s - 1) > 1e-9) out.push(`atempo=${n(s)}`);
  return out;
}

/** One annotation, already drawn into a transparent PNG at the source resolution, as FFmpeg input `input`. */
export interface AnnotationLayer { input: number; start: number; end: number }

/**
 * The filter graph for one clip: speed, then each blur box (cut out, blurred, laid back over the same
 * spot while it's active), then each annotation layer while it's active, then the frame scaled into
 * 1280x720 and the captions burned in. Blurs and annotations are placed at the source resolution,
 * before scaling, so their fractions of the frame mean the same as in the preview.
 */
export function segmentFilter(e: Edl, index: number, o: { hasAudio: boolean; captions: string | null; layers?: AnnotationLayer[] }): string {
  const c = e.clips[index]!;
  const parts: string[] = [];
  let v = "v0";
  parts.push(`[0:v]setpts=(PTS-STARTPTS)/${n(c.speed)}[${v}]`);
  clipBlurs(e, index).forEach((b, k) => {
    const enable = `between(t,${n(b.start)},${n(b.end)})`;
    parts.push(
      `[${v}]split[m${k}][s${k}]`,
      `[s${k}]crop=w=iw*${n(b.w)}:h=ih*${n(b.h)}:x=iw*${n(b.x)}:y=ih*${n(b.y)},boxblur=luma_radius='min(w,h)/4':luma_power=3:chroma_radius='min(cw,ch)/4':chroma_power=3[b${k}]`,
      `[m${k}][b${k}]overlay=x=main_w*${n(b.x)}:y=main_h*${n(b.y)}:enable='${enable}'[v${k + 1}]`,
    );
    v = `v${k + 1}`;
  });
  (o.layers ?? []).forEach((l, k) => {
    parts.push(`[${v}][${l.input}:v]overlay=0:0:enable='between(t,${n(l.start)},${n(l.end)})'[a${k}]`);
    v = `a${k}`;
  });
  const look = [`fps=${FPS}`, `scale=${OUT_W}:${OUT_H}:force_original_aspect_ratio=decrease`, `pad=${OUT_W}:${OUT_H}:(ow-iw)/2:(oh-ih)/2:color=black`, "setsar=1", "format=yuv420p"];
  if (o.captions) look.push(`subtitles=${o.captions}:force_style='${CAPTION_STYLE}'`);
  parts.push(`[${v}]${look.join(",")}[vout]`);
  const len = (c.srcOut - c.srcIn) / c.speed;
  parts.push(o.hasAudio
    ? `[0:a]${["asetpts=PTS-STARTPTS", ...atempoChain(c.speed), ...(e.audio.denoise ? ["afftdn=nf=-25"] : []), "aresample=48000", "aformat=sample_fmts=fltp:channel_layouts=stereo"].join(",")}[aout]`
    : `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${n(len)}[aout]`);
  return parts.join(";");
}

/** Full argument list for one clip's segment. File names are relative to the render's temp folder. */
export function segmentArgs(e: Edl, index: number, o: { input: string; hasAudio: boolean; captions: string | null; filterScript: string; output: string; layerFiles?: string[] }): string[] {
  const c = e.clips[index]!;
  return [
    "-ss", n(c.srcIn), "-t", n(c.srcOut - c.srcIn), "-i", o.input,
    ...(o.layerFiles ?? []).flatMap((f) => ["-i", f]),
    "-filter_complex_script", o.filterScript, "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-r", String(FPS),
    "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
    "-video_track_timescale", "15360", "-shortest", o.output,
  ];
}

/** Second pass when "even out volume" is on: the joined video's audio levelled to -16 LUFS (EBU R128); the picture is copied. */
export const normalizeArgs = (input: string, output: string) =>
  ["-i", input, "-map", "0:v", "-map", "0:a", "-c:v", "copy", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-movflags", "+faststart", output];

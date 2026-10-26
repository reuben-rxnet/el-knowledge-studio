// FFmpeg arguments for Studio renders. Each clip is rendered to its own segment (accurate seek,
// re-encoded, so cuts land on the exact frame), then the segments are joined without re-encoding and
// a last pass adds music, AI voice, soft subtitles and chapters. Rendering clip by clip keeps memory
// flat however long the recording is.
import { baseView, clipBlurs, clipZooms, FPS, OUTPUT_SIZE, toOutput, ZOOM_RAMP_SEC, type Cue, type Edl } from "./edl";

/** The 16:9 size; other shapes are in OUTPUT_SIZE. */
export const OUT_W = 1280, OUT_H = 720;
const n = (x: number) => (Math.round(x * 100000) / 100000).toString();

/** Caption style for libass. SRT sizes scale with the frame height, so taller frames need a smaller size. */
export function captionStyle(e: Edl, o: { size?: number; color?: "white" | "yellow" } = {}) {
  const base = e.output.aspect === "9:16" ? 11 : e.output.aspect === "1:1" ? 15 : 20;
  const colour = o.color === "yellow" ? "&H0000E5FF" : "&H00FFFFFF";
  return `FontName=Segoe UI,FontSize=${Math.round(base * (o.size ?? 1))},PrimaryColour=${colour},BackColour=&H80000000,BorderStyle=4,Outline=0,MarginV=${e.output.aspect === "9:16" ? 30 : 28}`;
}

/** atempo only takes 0.5-2 per filter, so 4x is 2x then 2x. */
export function atempoChain(speed: number): string[] {
  const out: string[] = [];
  let s = speed;
  while (s > 2 + 1e-9) { out.push("atempo=2"); s /= 2; }
  while (s < 0.5 - 1e-9) { out.push("atempo=0.5"); s /= 0.5; }
  if (Math.abs(s - 1) > 1e-9) out.push(`atempo=${n(s)}`);
  return out;
}

/** One picture drawn into a transparent PNG, as FFmpeg input `input`, shown from start to end (clip time). */
export interface AnnotationLayer { input: number; start: number; end: number }

/**
 * The camera rectangle for one clip as FFmpeg expressions (the four corners for `perspective`, in
 * input pixels), the same maths as viewAt() in edl.ts: each zoom's smoothstep weight at the source
 * time, summed into a zoom factor and a focus point, then the rectangle kept inside the frame.
 * Stored variables: 0 source time, 1-2 ease in/out, 4 zoom, 5-6 focus then corner, 7-8 size.
 * `in` is the frame number within the clip, after fps=30.
 */
export function cameraCorners(e: Edl, index: number, srcAspect: number): Record<"x0" | "y0" | "x1" | "y1" | "x2" | "y2" | "x3" | "y3", string> {
  const c = e.clips[index]!;
  const { bw, bh } = baseView(e, srcAspect);
  const steps = [`st(0,${n(c.srcIn)}+in/${FPS}*${n(c.speed)})`, "st(4,1)", "st(5,0.5)", "st(6,0.5)"];
  for (const z of clipZooms(e, index)) {
    const ease = (v: number, u: string) => `st(${v},clip(${u},0,1));st(${v},ld(${v})*ld(${v})*(3-2*ld(${v})))`;
    steps.push(
      ease(1, `(ld(0)-${n(z.srcStart)})/${n(ZOOM_RAMP_SEC)}`),
      ease(2, `(${n(z.srcEnd)}-ld(0))/${n(ZOOM_RAMP_SEC)}`),
      "st(1,ld(1)*ld(2))",
      `st(4,ld(4)+ld(1)*${n(z.scale - 1)})`, `st(5,ld(5)+ld(1)*${n(z.x - 0.5)})`, `st(6,ld(6)+ld(1)*${n(z.y - 0.5)})`,
    );
  }
  steps.push("st(4,clip(ld(4),1,4))", `st(7,${n(bw)}/ld(4))`, `st(8,${n(bh)}/ld(4))`, "st(5,clip(ld(5)-ld(7)/2,0,1-ld(7)))", "st(6,clip(ld(6)-ld(8)/2,0,1-ld(8)))");
  const pre = steps.join(";");
  const at = (v: string) => `'${pre};${v}'`;
  return {
    x0: at("W*ld(5)"), y0: at("H*ld(6)"), x1: at("W*(ld(5)+ld(7))"), y1: at("H*ld(6)"),
    x2: at("W*ld(5)"), y2: at("H*(ld(6)+ld(8))"), x3: at("W*(ld(5)+ld(7))"), y3: at("H*(ld(6)+ld(8))"),
  };
}

/**
 * The filter graph for one clip: speed, each blur box (cut out, blurred, laid back over the same spot
 * while it's active), each annotation layer while it's active, then the camera (zooms, and the frame
 * shape for "fill"), the frame scaled into the output size, the output-space layers (lower third) and
 * the captions. Blurs and annotations are placed at the source resolution, before the camera, so they
 * zoom with the picture exactly as in the preview; captions and the lower third stay put.
 */
export function segmentFilter(e: Edl, index: number, o: { hasAudio: boolean; captions: string | null; layers?: AnnotationLayer[]; overlays?: AnnotationLayer[]; srcAspect?: number; captionStyle?: string; mute?: boolean }): string {
  const c = e.clips[index]!;
  const { w: OW, h: OH } = OUTPUT_SIZE[e.output.aspect];
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
  const look = [`fps=${FPS}`];
  const zooms = clipZooms(e, index).length > 0;
  if (zooms || e.output.fit === "fill") {
    // Sub-pixel camera: perspective maps the rectangle onto the whole frame (smooth, unlike zoompan's
    // whole-pixel steps); the scale after it gives the output its size and shape.
    const k = cameraCorners(e, index, o.srcAspect ?? 16 / 9);
    look.push(`perspective=x0=${k.x0}:y0=${k.y0}:x1=${k.x1}:y1=${k.y1}:x2=${k.x2}:y2=${k.y2}:x3=${k.x3}:y3=${k.y3}:interpolation=linear:sense=source:eval=frame`);
  }
  if (e.output.fit === "fill") look.push(`scale=${OW}:${OH}`);
  else look.push(`scale=${OW}:${OH}:force_original_aspect_ratio=decrease`, `pad=${OW}:${OH}:(ow-iw)/2:(oh-ih)/2:color=black`);
  look.push("setsar=1", "format=yuv420p");
  parts.push(`[${v}]${look.join(",")}[p0]`);
  v = "p0";
  (o.overlays ?? []).forEach((l, k) => {
    parts.push(`[${v}][${l.input}:v]overlay=0:0:enable='between(t,${n(l.start)},${n(l.end)})'[o${k}]`);
    v = `o${k}`;
  });
  parts.push(o.captions ? `[${v}]subtitles=${o.captions}:force_style='${o.captionStyle ?? captionStyle(e)}'[vout]` : `[${v}]null[vout]`);
  const len = (c.srcOut - c.srcIn) / c.speed;
  parts.push(o.hasAudio && !o.mute
    ? `[0:a]${["asetpts=PTS-STARTPTS", ...atempoChain(c.speed), ...(e.audio.denoise ? ["afftdn=nf=-25"] : []), "aresample=48000", "aformat=sample_fmts=fltp:channel_layouts=stereo"].join(",")}[aout]`
    : `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${n(len)}[aout]`);
  return parts.join(";");
}

const ENCODE = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-r", String(FPS), "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2", "-video_track_timescale", "15360"];

/** Full argument list for one clip's segment. File names are relative to the render's temp folder. */
export function segmentArgs(e: Edl, index: number, o: { input: string; hasAudio: boolean; captions: string | null; filterScript: string; output: string; layerFiles?: string[] }): string[] {
  const c = e.clips[index]!;
  return [
    "-ss", n(c.srcIn), "-t", n(c.srcOut - c.srcIn), "-i", o.input,
    ...(o.layerFiles ?? []).flatMap((f) => ["-i", f]),
    "-filter_complex_script", o.filterScript, "-map", "[vout]", "-map", "[aout]",
    ...ENCODE, "-shortest", o.output,
  ];
}

/** A still card (intro or outro PNG at the output size) as a segment that joins with the clips. */
export const cardArgs = (image: string, seconds: number, output: string) => [
  "-loop", "1", "-framerate", String(FPS), "-t", n(seconds), "-i", image,
  "-f", "lavfi", "-t", n(seconds), "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
  "-vf", "format=yuv420p,setsar=1", "-map", "0:v", "-map", "1:a", ...ENCODE, "-t", n(seconds), output,
];

/** ISO 639-2 codes for MP4 subtitle tracks (MP4 language tags are three letters). */
const ISO3: Record<string, string> = { en: "eng", it: "ita", fr: "fra", de: "deu", es: "spa", pt: "por", nl: "nld", pl: "pol", ru: "rus", tr: "tur", zh: "zho", ja: "jpn", ko: "kor", ar: "ara", hi: "hin", sv: "swe", da: "dan", fi: "fin", no: "nor", cs: "ces", el: "ell", hu: "hun", ro: "ron", th: "tha", vi: "vie", id: "ind", ms: "msa", he: "heb", uk: "ukr" };
export const iso3 = (lang: string) => ISO3[lang.split("-")[0]!.toLowerCase()] ?? "und";

/**
 * The last pass over the joined video: the picture is copied, the sound is finished. The base sound is
 * the recording's (or the AI voice track); music is looped under it, quieter whenever someone speaks
 * (sidechain compression keyed by the voice) and faded out at the end; then levelled to -16 LUFS if
 * asked. Soft subtitle tracks (one per language) and chapters are added here too.
 */
export function finishArgs(o: {
  input: string; output: string; duration: number;
  voice?: string; music?: string; musicVolume?: number; duck?: boolean; normalize?: boolean;
  subtitles?: { file: string; language: string }[]; chapters?: string;
}): string[] {
  const args = ["-i", o.input];
  let next = 1;
  const voiceIn = o.voice ? next++ : null;
  if (o.voice) args.push("-i", o.voice);
  const musicIn = o.music ? next++ : null;
  if (o.music) args.push("-stream_loop", "-1", "-i", o.music);
  const subs = (o.subtitles ?? []).map((s) => { args.push("-i", s.file); return { ...s, input: next++ }; });
  const chaptersIn = o.chapters ? next++ : null;
  if (o.chapters) args.push("-i", o.chapters);

  const graph: string[] = [];
  let a = voiceIn !== null ? `[${voiceIn}:a]` : "[0:a]";
  if (voiceIn !== null) { graph.push(`${a}aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=${n(o.duration)}[voice]`); a = "[voice]"; }
  if (musicIn !== null) {
    graph.push(`[${musicIn}:a]atrim=duration=${n(o.duration)},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${n(o.musicVolume ?? 0.25)},afade=t=out:st=${n(Math.max(0, o.duration - 2))}:d=2[mus]`);
    if (o.duck !== false) {
      graph.push(`${a}asplit=2[key][base]`, "[mus][key]sidechaincompress=threshold=0.02:ratio=12:attack=20:release=400:makeup=1[duck]", "[base][duck]amix=inputs=2:duration=first:normalize=0[mix]");
    } else graph.push(`${a}[mus]amix=inputs=2:duration=first:normalize=0[mix]`);
    a = "[mix]";
  }
  if (o.normalize) { graph.push(`${a}loudnorm=I=-16:TP=-1.5:LRA=11[norm]`); a = "[norm]"; }

  if (graph.length) args.push("-filter_complex", graph.join(";"), "-map", "0:v", "-map", a);
  else args.push("-map", "0:v", "-map", "0:a");
  subs.forEach((s) => args.push("-map", `${s.input}:0`));
  args.push("-c:v", "copy");
  args.push(...(graph.length ? ["-c:a", "aac", "-b:a", "128k", "-ar", "48000"] : ["-c:a", "copy"]));
  if (subs.length) {
    args.push("-c:s", "mov_text");
    subs.forEach((s, k) => args.push(`-metadata:s:s:${k}`, `language=${iso3(s.language)}`, `-metadata:s:s:${k}`, `title=${s.language}`));
  }
  if (chaptersIn !== null) args.push("-map_metadata", String(chaptersIn), "-map_chapters", String(chaptersIn));
  args.push("-t", n(o.duration), "-movflags", "+faststart", o.output);
  return args;
}

/** FFmpeg's metadata file format for chapters (times in milliseconds). Titles are escaped as it requires. */
export function ffmetadataChapters(chapters: { start: number; end: number; title: string }[]): string {
  const esc = (t: string) => t.replace(/[=;#\\\n]/g, (ch) => (ch === "\n" ? " " : `\\${ch}`));
  return [";FFMETADATA1", ...chapters.flatMap((c) => ["[CHAPTER]", "TIMEBASE=1/1000", `START=${Math.round(c.start * 1000)}`, `END=${Math.round(c.end * 1000)}`, `title=${esc(c.title)}`])].join("\n") + "\n";
}

/** Kept for the unit tests and older callers: loudness only, the picture copied. */
export const normalizeArgs = (input: string, output: string) =>
  ["-i", input, "-map", "0:v", "-map", "0:a", "-c:v", "copy", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-movflags", "+faststart", output];

/**
 * Where each AI voice paragraph goes in the output: it starts where its caption starts in the edit
 * (after the intro, `offset`), and has until the next one starts (or the end) to finish. Captions on
 * cut material are left out.
 */
export function voicePlacement(e: Edl, cues: Cue[], offset: number, total: number): { at: number; text: string; slot: number }[] {
  const placed = cues.flatMap((c) => { const r = toOutput(e, c.start, c.end)[0]; return r ? [{ at: r.start + offset, text: c.text }] : []; }).sort((a, b) => a.at - b.at);
  return placed.map((p, k) => ({ ...p, slot: Math.max(0.8, (placed[k + 1]?.at ?? total) - p.at - 0.15) }));
}

/** A paragraph longer than its slot is spoken faster to fit, but never above 1.35x (still easy to follow). */
export const voiceSpeed = (seconds: number, slot: number) => (seconds > slot ? Math.min(1.35, seconds / slot) : 1);

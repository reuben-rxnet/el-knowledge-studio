import "server-only";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { db } from "@/lib/database/client";
import { mediaDurationSec, probeMedia, runFfmpeg } from "@/lib/services/local/ffmpeg";
import { synthesizeSpeech, TTS_LANGUAGES, TTS_VOICES, type TtsVoice } from "@/lib/services/local/speech";
import { saveFile, saveStream, storageKeyFor, withLocalFile } from "@/lib/services/storage";
import { clipAnnotations, clipCues, clipLength, clipStarts, edlSchema, outputChapters, outputCues, outputDuration, OUTPUT_SIZE, toOutput, type Cue, type Edl } from "@/lib/studio/edl";
import { byDrawOrder, drawAnnotation, type Ctx } from "@/lib/studio/draw-annotations";
import { drawCard, drawLowerThird, logoSvg, type BrandCtx, type LogoImage } from "@/lib/studio/draw-brand";
import { CAPTION_SIZES } from "@/lib/studio/brand-template";
import { BUILT_IN_MUSIC } from "@/lib/studio/music";
import { captionStyle, cardArgs, ffmetadataChapters, finishArgs, segmentArgs, segmentFilter } from "@/lib/studio/render-args";
import { getBrandTemplate, getUploadedMusic } from "@/server/settings";
import { studioCaptions, studioSource } from "@/server/studio";

const srtTime = (s: number) => {
  const ms = Math.round(s * 1000), h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), sec = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};
const clean = (t: string) => t.replace(/\r?\n+/g, " ").trim();
const srt = (cues: Cue[]) => cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(Math.max(c.end, c.start + 0.3))}\n${clean(c.text)}\n`).join("\n");
const vtt = (cues: Cue[]) => `WEBVTT\n\n${cues.map((c) => `${srtTime(c.start).replace(",", ".")} --> ${srtTime(Math.max(c.end, c.start + 0.3)).replace(",", ".")}\n${clean(c.text)}\n`).join("\n")}`;
const shift = (cues: Cue[], by: number) => cues.map((c) => ({ ...c, start: c.start + by, end: c.end + by }));

const progress = (id: string, detail: string) => db.renderJob.update({ where: { id }, data: { detail } });

async function loadLogo(): Promise<LogoImage | null> {
  try {
    const { loadImage } = await import("@napi-rs/canvas");
    const file = await readFile(path.join(/* turbopackIgnore: true */ process.cwd(), "public", "brand", "essilorluxottica_logo.svg"), "utf8");
    const image = await loadImage(Buffer.from(logoSvg(file, "#FFFFFF")));
    return { image, width: image.width, height: image.height };
  } catch {
    return null; // the cards still render, without the wordmark
  }
}

/**
 * Renders a Studio edit list:
 *   1. an intro card (brand template), if switched on
 *   2. each clip as its own segment: exact cut, speed, blur boxes, annotations, the camera (zooms and
 *      the frame's shape), the lower third at the start, burned-in captions
 *   3. an outro card, if switched on
 *   4. the segments joined without re-encoding, then one finishing pass: AI voice or the recorded
 *      sound, music ducked under it, loudness, a soft subtitle track per language, and chapters
 * All text reaches FFmpeg through files, never the command line; everything runs in a private temp folder.
 */
export async function runStudioRender(jobId: string) {
  const claim = await db.renderJob.updateMany({ where: { id: jobId, status: "queued", engine: "studio" }, data: { status: "running", detail: "Starting" } });
  if (!claim.count) return;
  const job = await db.renderJob.findUniqueOrThrow({ where: { id: jobId }, include: { project: { include: { owner: { select: { displayName: true } } } } } });
  const p = job.project;
  const dir = await mkdtemp(path.join(os.tmpdir(), "elks-studio-"));
  try {
    const [row, media, template] = await Promise.all([db.studioEdit.findUnique({ where: { projectId: p.id } }), studioSource(p.id), getBrandTemplate()]);
    if (!row || !media) throw new Error("This project has no Studio edit or no video.");
    const edl = edlSchema.parse(JSON.parse(row.edl));
    const captions = await studioCaptions(p, media);
    const language = edl.captionLanguage && captions[edl.captionLanguage] ? edl.captionLanguage : p.primaryLanguage;
    const burn = job.captions && !media.burnedCaptions;
    const { w: OW, h: OH } = OUTPUT_SIZE[edl.output.aspect];
    const introSec = edl.brand.intro ? template.introSec : 0, outroSec = edl.brand.outro ? template.outroSec : 0;
    const total = introSec + outputDuration(edl) + outroSec;
    const { createCanvas } = await import("@napi-rs/canvas");
    const logo = edl.brand.intro || edl.brand.outro ? await loadLogo() : null;
    const card = async (kind: "intro" | "outro", file: string) => {
      const canvas = createCanvas(OW, OH);
      drawCard(canvas.getContext("2d") as unknown as BrandCtx, OW, OH, {
        kind, title: p.title, template, logo,
        subtitle: kind === "intro" ? `${p.businessFunction} · version ${job.version}` : `Owner: ${p.owner.displayName}`,
      });
      await writeFile(path.join(dir, file), canvas.toBuffer("image/png"));
    };
    const names: string[] = [];

    if (introSec) {
      await progress(job.id, "Rendering the intro");
      await card("intro", "intro.png");
      await runFfmpeg(cardArgs("intro.png", introSec, "seg-000.mp4"), { cwd: dir });
      names.push("seg-000.mp4");
    }

    await withLocalFile(media.storageKey, async (input) => {
      const { hasAudio, width, height } = await probeMedia(input);
      const srcAspect = width && height ? width / height : 16 / 9;
      // The lower third: one PNG at the output size, shown from 0.4 s for the template's time.
      let lowerThird: string | null = null;
      if (edl.brand.lowerThird) {
        const canvas = createCanvas(OW, OH);
        drawLowerThird(canvas.getContext("2d") as unknown as BrandCtx, OW, OH, { title: p.title, subtitle: `${p.businessFunction} · ${p.processCategory}`, template });
        lowerThird = "lower-third.png";
        await writeFile(path.join(dir, lowerThird), canvas.toBuffer("image/png"));
      }
      const starts = clipStarts(edl);
      const style = captionStyle(edl, { size: CAPTION_SIZES[template.captionSize], color: template.captionColor });
      for (const [i, c] of edl.clips.entries()) {
        await progress(job.id, `Rendering clip ${i + 1} of ${edl.clips.length}`);
        const cues = burn ? clipCues(edl, i, captions[language]!) : [];
        const captionFile = cues.length ? `clip-${i + 1}.srt` : null;
        if (captionFile) await writeFile(path.join(dir, captionFile), srt(cues), "utf8");
        // Each annotation becomes a transparent PNG at the recording's size, drawn by the same code as the preview.
        const layerFiles: string[] = [];
        const layers = [];
        for (const [k, a] of byDrawOrder(clipAnnotations(edl, i)).entries()) {
          const canvas = createCanvas(width || 1280, height || 720);
          drawAnnotation(canvas.getContext("2d") as unknown as Ctx, a, canvas.width, canvas.height);
          const file = `clip-${i + 1}-note-${k + 1}.png`;
          await writeFile(path.join(dir, file), canvas.toBuffer("image/png"));
          layerFiles.push(file);
          layers.push({ input: k + 1, start: a.start, end: a.end });
        }
        const overlays = [];
        if (lowerThird) {
          const a = Math.max(0.4, starts[i]!), b = Math.min(0.4 + template.lowerThirdSec, starts[i]! + clipLength(c));
          if (b > a) { layerFiles.push(lowerThird); overlays.push({ input: layerFiles.length, start: a - starts[i]!, end: b - starts[i]! }); }
        }
        const filterScript = `clip-${i + 1}.filter`;
        await writeFile(path.join(dir, filterScript), segmentFilter(edl, i, { hasAudio, captions: captionFile, layers, overlays, srcAspect, captionStyle: style, mute: edl.voice.ai }), "utf8");
        const name = `seg-${String(i + 1).padStart(3, "0")}.mp4`;
        await runFfmpeg(segmentArgs(edl, i, { input, hasAudio, captions: captionFile, filterScript, output: name, layerFiles }), { cwd: dir });
        names.push(name);
      }
    });

    if (outroSec) {
      await progress(job.id, "Rendering the outro");
      await card("outro", "outro.png");
      const name = `seg-${String(edl.clips.length + 1).padStart(3, "0")}.mp4`;
      await runFfmpeg(cardArgs("outro.png", outroSec, name), { cwd: dir });
      names.push(name);
    }

    await progress(job.id, "Joining the clips");
    await writeFile(path.join(dir, "clips.txt"), names.map((n) => `file '${n}'`).join("\n"), "utf8");
    await runFfmpeg(["-f", "concat", "-safe", "0", "-i", "clips.txt", "-c", "copy", "joined.mp4"], { cwd: dir });

    // AI voice: each script paragraph spoken where it appears in the edit, sped up a little if it would overrun the next.
    let voice: string | undefined;
    if (edl.voice.ai) voice = await voiceTrack(job.id, dir, edl, captions, language, p.primaryLanguage, introSec, total);

    // Soft subtitles for every language, in the finished video's time (after the intro).
    const subtitles: { file: string; language: string }[] = [];
    const tracks: { language: string; key: string }[] = [];
    for (const [lang, cues] of Object.entries(captions)) {
      const out = shift(outputCues(edl, cues), introSec);
      if (!out.length) continue;
      await writeFile(path.join(dir, `subs-${lang}.srt`), srt(out), "utf8");
      subtitles.push({ file: `subs-${lang}.srt`, language: lang });
      const key = storageKeyFor(p.workspaceId, `${p.title.slice(0, 40)}-v${job.version}-studio-${lang}.vtt`);
      await saveFile(key, Buffer.from(vtt(out), "utf8"), "text/vtt");
      tracks.push({ language: lang, key });
    }
    const chapters = outputChapters(edl, introSec, outroSec);
    if (chapters.length) await writeFile(path.join(dir, "chapters.txt"), ffmetadataChapters(chapters), "utf8");

    const music = edl.music.track ? await musicFile(edl.music.track) : null;
    await progress(job.id, voice || music || edl.audio.normalize ? "Mixing the sound" : "Finishing");
    const finish = async (musicPath?: string) => runFfmpeg(finishArgs({
      input: "joined.mp4", output: "out.mp4", duration: total, voice, music: musicPath, musicVolume: edl.music.volume, duck: edl.music.duck,
      normalize: edl.audio.normalize, subtitles, chapters: chapters.length ? "chapters.txt" : undefined,
    }), { cwd: dir });
    if (music?.builtIn) await finish(music.path);
    else if (music) await withLocalFile(music.path, (f) => finish(f));
    else await finish();

    const out = path.join(dir, "out.mp4");
    await progress(job.id, "Saving the video");
    const key = storageKeyFor(p.workspaceId, `${p.title.slice(0, 40)}-v${job.version}-studio.mp4`);
    await saveStream(key, createReadStream(out), "video/mp4");
    const durationSec = Math.round(await mediaDurationSec(out));
    const extras = [edl.zooms.length && `${edl.zooms.length} zooms`, edl.output.aspect !== "16:9" && edl.output.aspect, edl.voice.ai && "AI voice", music && "music", chapters.length && `${chapters.length} chapters`].filter(Boolean).join(", ");
    await db.$transaction([
      db.renderJob.update({
        where: { id: job.id },
        data: {
          status: "succeeded", detail: "Done", outputKey: key, durationSec, sizeBytes: (await stat(out)).size, completedAt: new Date(), language,
          aiVoice: edl.voice.ai, voice: edl.voice.ai ? edl.voice.voice : null, burnedCaptions: burn || media.burnedCaptions,
          cues: JSON.stringify(shift(outputCues(edl, captions[language]!), introSec)), chapters: chapters.length ? JSON.stringify(chapters) : null,
          captionTracks: tracks.length ? JSON.stringify(tracks) : null,
        },
      }),
      db.notification.create({ data: { userId: job.createdById, kind: "render.completed", title: "Studio video rendered", body: `${p.title} v${job.version} is ready to watch and download in Studio.`, href: `/projects/${p.id}/studio` } }),
      db.auditEvent.create({ data: { actorId: job.createdById, actorName: "EL Knowledge Studio (system)", action: "video.rendered", resourceType: "project", resourceId: p.id, resourceLabel: `${p.title} · Studio MP4 (${edl.clips.length} clips, ${edl.blurs.length} blurs${extras ? `, ${extras}` : ""})`, resourceVersion: job.version, workspaceId: p.workspaceId, outcome: "success", correlationId: job.id } }),
    ]);
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 300) : "Rendering failed.";
    await db.renderJob.update({ where: { id: job.id }, data: { status: "failed", detail: message, errorCode: "RENDER_FAILED", completedAt: new Date() } });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** A built-in track's file in public/, or an uploaded one's storage key. */
async function musicFile(id: string): Promise<{ builtIn: boolean; path: string } | null> {
  if (BUILT_IN_MUSIC.some((t) => t.id === id)) return { builtIn: true, path: path.join(/* turbopackIgnore: true */ process.cwd(), "public", "studio", "music", `${id}.m4a`) };
  const up = (await getUploadedMusic()).find((t) => t.id === id);
  return up ? { builtIn: false, path: up.storageKey } : null;
}

/**
 * The AI voice track (48 kHz stereo WAV, the whole video long). It speaks the caption language when
 * the voice model has it, otherwise the project's language. Each paragraph starts where its caption
 * starts in the edit; if it would run into the next one, it's spoken faster (up to 1.35x) to fit.
 */
async function voiceTrack(jobId: string, dir: string, edl: Edl, captions: Record<string, Cue[]>, language: string, primary: string, offset: number, total: number): Promise<string> {
  const lang = TTS_LANGUAGES.includes(language) ? language : primary;
  if (!TTS_LANGUAGES.includes(lang)) throw new Error(`AI voice speaks ${TTS_LANGUAGES.join(", ")} only; this project's captions are in ${lang}.`);
  const voice = (TTS_VOICES.some((v) => v.id === edl.voice.voice) ? edl.voice.voice : TTS_VOICES[0].id) as TtsVoice;
  const placed = (captions[lang] ?? []).flatMap((c) => { const r = toOutput(edl, c.start, c.end)[0]; return r ? [{ at: r.start + offset, text: c.text }] : []; }).sort((a, b) => a.at - b.at);
  if (!placed.length) throw new Error("There's no script to read: AI voice needs the script's paragraphs.");
  const inputs: string[] = [], delays: string[] = [];
  for (const [k, s] of placed.entries()) {
    await progress(jobId, `Generating AI voice ${k + 1} of ${placed.length} (the first run loads the voice model)`);
    const slot = Math.max(0.8, (placed[k + 1]?.at ?? total) - s.at - 0.15);
    let clip = await synthesizeSpeech(s.text, voice);
    if (clip.seconds > slot) clip = await synthesizeSpeech(s.text, voice, Math.min(1.35, clip.seconds / slot));
    const file = `voice-${k}.wav`;
    await writeFile(path.join(dir, file), clip.wav);
    inputs.push("-i", file);
    const ms = Math.round(s.at * 1000);
    delays.push(`[${k}:a]aresample=48000,adelay=${ms}|${ms}[d${k}]`);
  }
  const mix = `${delays.join(";")};${placed.map((_, k) => `[d${k}]`).join("")}amix=inputs=${placed.length}:normalize=0,aformat=channel_layouts=stereo,apad,atrim=duration=${total.toFixed(3)}[voice]`;
  await writeFile(path.join(dir, "voice.filter"), mix, "utf8");
  await runFfmpeg([...inputs, "-filter_complex_script", "voice.filter", "-map", "[voice]", "-ar", "48000", "voice.wav"], { cwd: dir });
  return "voice.wav";
}

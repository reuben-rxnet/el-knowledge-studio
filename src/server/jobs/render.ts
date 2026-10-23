import "server-only";
import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { db } from "@/lib/database/client";
import { isMediaSource } from "@/lib/domain/constants";
import { mediaDurationSec, runFfmpeg } from "@/lib/services/local/ffmpeg";
import { synthesizeSpeech, TTS_LANGUAGES, type TtsVoice } from "@/lib/services/local/speech";
import { saveFile, storageKeyFor, withLocalFile } from "@/lib/services/storage";

/**
 * Renders a project version to MP4 with FFmpeg (open source), on this server.
 *   Recording projects: the original video, captions burned in, redacted scenes blurred, and
 *     optionally an AI narration track (Kokoro, English) instead of the original audio.
 *   Document projects: a title card + one slide per chapter, each narrated (AI voice) or timed
 *     to reading speed, with a soft captions track.
 * FFmpeg runs in a private temp folder with relative file names, and all text reaches it through
 * files (textfile=, .srt), never through the command line.
 */
const W = 1280, H = 720;
const FONTS = ["C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/System/Library/Fonts/Supplemental/Arial.ttf"];
const FONTS_BOLD = ["C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/arialbd.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"];

const srtTime = (s: number) => {
  const ms = Math.round(s * 1000), h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), sec = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};
const srt = (cues: { start: number; end: number; text: string }[]) => cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(Math.max(c.end, c.start + 0.5))}\n${c.text.replace(/\r?\n+/g, " ").trim()}\n`).join("\n");

/** Hard-wraps text for drawtext (svg-like: FFmpeg doesn't wrap). */
function wrap(text: string, width: number, maxLines: number) {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > width) { if (line) lines.push(line); line = w; } else line = (line + " " + w).trim();
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1]!.replace(/.{0,3}$/, "…"); }
  return lines.join("\n");
}

async function progress(jobId: string, detail: string) {
  await db.renderJob.update({ where: { id: jobId }, data: { detail } });
}

export async function runRender(jobId: string) {
  const claim = await db.renderJob.updateMany({ where: { id: jobId, status: "queued" }, data: { status: "running", detail: "Starting" } });
  if (!claim.count) return;
  const job = await db.renderJob.findUniqueOrThrow({ where: { id: jobId }, include: { project: true } });
  const p = job.project;
  const dir = await mkdtemp(path.join(os.tmpdir(), "elks-render-"));
  try {
    const [scenes, script, source, translated] = await Promise.all([
      db.scene.findMany({ where: { projectId: p.id }, orderBy: { order: "asc" } }),
      db.scriptSegment.findMany({ where: { projectId: p.id }, orderBy: { order: "asc" } }),
      db.sourceAsset.findFirst({ where: { projectId: p.id, storedBytes: true }, orderBy: { createdAt: "desc" } }),
      job.language !== p.primaryLanguage ? db.translationSegment.findMany({ where: { projectId: p.id, language: job.language, sourceType: "script" } }) : Promise.resolve([]),
    ]);
    if (!script.length) throw new Error("This project has no script to render.");
    const tr = new Map(translated.map((t) => [t.sourceId, t.text]));
    const text = (i: number) => tr.get(script[i]!.id) ?? script[i]!.text;
    const useVoice = job.aiVoice && TTS_LANGUAGES.includes(job.language);
    const font = FONTS.find((f) => existsSync(f));
    const fontBold = FONTS_BOLD.find((f) => existsSync(f)) ?? font;
    if (font) await copyFile(font, path.join(dir, "font.ttf"));
    if (fontBold) await copyFile(fontBold, path.join(dir, "font-bold.ttf"));

    // 1. Narration clips (AI voice), one per script paragraph.
    const clipSec: number[] = [];
    if (useVoice) {
      for (const [i] of script.entries()) {
        await progress(job.id, `Generating AI voice ${i + 1} of ${script.length} (first run loads the voice model)`);
        const { wav, seconds } = await synthesizeSpeech(text(i), (job.voice ?? "bf_emma") as TtsVoice);
        await writeFile(path.join(dir, `voice-${i}.wav`), wav);
        clipSec.push(seconds);
      }
    }

    const recording = isMediaSource(p.sourceKind) && source && isMediaSource(source.kind);
    const out = path.join(dir, "out.mp4");
    if (recording) {
      // 2a. Recording: captions + blur over the real video.
      await progress(job.id, "Rendering the recording with captions and redactions");
      await withLocalFile(source.storageKey, async (input) => {
        await writeFile(path.join(dir, "captions.srt"), srt(script.map((s, i) => ({ start: s.startSec, end: s.endSec, text: text(i) }))), "utf8");
        const blurs = scenes.filter((s) => s.redaction).map((s) => `boxblur=20:2:enable='between(t,${s.startSec},${s.endSec})'`);
        const style = "FontName=Segoe UI,FontSize=20,PrimaryColour=&H00FFFFFF,BackColour=&H80000000,BorderStyle=4,Outline=0,MarginV=28";
        const vf = [`scale=-2:${H}`, ...blurs, `subtitles=captions.srt:force_style='${style}'`].join(",");
        const args = ["-i", input];
        if (useVoice) {
          script.forEach((_, i) => args.push("-i", `voice-${i}.wav`));
          const delays = script.map((s, i) => `[${i + 1}:a]adelay=${Math.round(s.startSec * 1000)}|${Math.round(s.startSec * 1000)}[a${i}]`).join(";");
          const mix = `${script.map((_, i) => `[a${i}]`).join("")}amix=inputs=${script.length}:normalize=0[aout]`;
          args.push("-filter_complex", `[0:v]${vf}[vout];${delays};${mix}`, "-map", "[vout]", "-map", "[aout]");
        } else {
          args.push("-vf", vf, "-map", "0:v:0", "-map", "0:a?");
        }
        args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "out.mp4");
        await runFfmpeg(args, { cwd: dir });
      });
    } else {
      // 2b. Document: title card + a narrated slide per chapter, then concatenate.
      const parts: string[] = [];
      const cues: { start: number; end: number; text: string }[] = [];
      let t = 0;
      const slide = async (name: string, seconds: number, lines: { file: string; size: number; y: string; bold?: boolean; color: string }[], audio?: string) => {
        const draw = lines.map((l) => `drawtext=fontfile=${l.bold ? "font-bold.ttf" : "font.ttf"}:textfile=${l.file}:fontsize=${l.size}:fontcolor=${l.color}:x=80:y=${l.y}:line_spacing=12`).join(",");
        const args = ["-f", "lavfi", "-i", `color=c=0x0B2D5B:s=${W}x${H}:d=${seconds.toFixed(2)}:r=30`];
        args.push(...(audio ? ["-i", audio] : ["-f", "lavfi", "-t", seconds.toFixed(2), "-i", "anullsrc=r=24000:cl=mono"]));
        args.push("-vf", `drawbox=x=0:y=${H - 8}:w=iw:h=8:color=0x00A6CE:t=fill,${draw}`, "-af", `apad=whole_dur=${seconds.toFixed(2)}`, "-t", seconds.toFixed(2),
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "24000", "-ac", "1", name);
        await runFfmpeg(args, { cwd: dir });
        parts.push(name);
      };
      await progress(job.id, "Rendering the title card");
      await writeFile(path.join(dir, "t-title.txt"), wrap(p.title, 34, 3), "utf8");
      await writeFile(path.join(dir, "t-sub.txt"), "EL Knowledge Studio", "utf8");
      await slide("part-000.mp4", 3, [{ file: "t-sub.txt", size: 26, y: "200", color: "0x00A6CE" }, { file: "t-title.txt", size: 56, y: "260", bold: true, color: "white" }]);
      t += 3;
      for (const [i, sc] of scenes.entries()) {
        await progress(job.id, `Rendering chapter ${i + 1} of ${scenes.length}`);
        const body = text(Math.min(i, script.length - 1));
        const seconds = useVoice ? (clipSec[Math.min(i, clipSec.length - 1)] ?? 3) + 0.8 : Math.min(20, Math.max(4, body.split(/\s+/).length / 2.6));
        await writeFile(path.join(dir, `c-${i}-n.txt`), `Step ${i + 1} of ${scenes.length}`, "utf8");
        await writeFile(path.join(dir, `c-${i}-t.txt`), wrap(sc.title, 40, 2), "utf8");
        await writeFile(path.join(dir, `c-${i}-b.txt`), wrap(body, 58, 8), "utf8");
        await slide(`part-${String(i + 1).padStart(3, "0")}.mp4`, seconds, [
          { file: `c-${i}-n.txt`, size: 24, y: "90", color: "0x00A6CE" },
          { file: `c-${i}-t.txt`, size: 44, y: "140", bold: true, color: "white" },
          { file: `c-${i}-b.txt`, size: 30, y: "290", color: "0xDCE3EA" },
        ], useVoice ? `voice-${Math.min(i, clipSec.length - 1)}.wav` : undefined);
        cues.push({ start: t, end: t + seconds, text: body });
        t += seconds;
      }
      await progress(job.id, "Joining chapters into one video");
      await writeFile(path.join(dir, "parts.txt"), parts.map((n) => `file '${n}'`).join("\n"), "utf8");
      await writeFile(path.join(dir, "captions.srt"), srt(cues), "utf8");
      await runFfmpeg(["-f", "concat", "-safe", "0", "-i", "parts.txt", "-i", "captions.srt", "-map", "0:v", "-map", "0:a", "-map", "1:0", "-c:v", "copy", "-c:a", "copy", "-c:s", "mov_text", "-metadata:s:s:0", `language=${job.language}`, "-movflags", "+faststart", "out.mp4"], { cwd: dir });
    }

    await progress(job.id, "Saving the video");
    const buf = await readFile(out);
    const key = storageKeyFor(p.workspaceId, `${p.title.slice(0, 40)}-v${job.version}-${job.language}.mp4`);
    await saveFile(key, buf, "video/mp4");
    const durationSec = Math.round(await mediaDurationSec(out));
    await db.$transaction([
      db.renderJob.update({ where: { id: job.id }, data: { status: "succeeded", detail: "Done", outputKey: key, durationSec, sizeBytes: (await stat(out)).size, completedAt: new Date() } }),
      db.notification.create({ data: { userId: job.createdById, kind: "render.completed", title: "Video rendered", body: `${p.title} v${job.version} (${job.language}) is ready to watch and download.`, href: `/projects/${p.id}/video` } }),
      db.auditEvent.create({ data: { actorId: job.createdById, actorName: "EL Knowledge Studio (system)", action: "video.rendered", resourceType: "project", resourceId: p.id, resourceLabel: `${p.title} · MP4 ${job.language}${useVoice ? " · AI voice" : ""}`, resourceVersion: job.version, workspaceId: p.workspaceId, outcome: "success", correlationId: job.id } }),
    ]);
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 300) : "Rendering failed.";
    await db.renderJob.update({ where: { id: job.id }, data: { status: "failed", detail: message, errorCode: "RENDER_FAILED", completedAt: new Date() } });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

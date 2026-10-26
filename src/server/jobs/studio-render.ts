import "server-only";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { db } from "@/lib/database/client";
import { mediaDurationSec, probeMedia, runFfmpeg } from "@/lib/services/local/ffmpeg";
import { saveStream, storageKeyFor, withLocalFile } from "@/lib/services/storage";
import { clipCues, edlSchema, type Cue } from "@/lib/studio/edl";
import { segmentArgs, segmentFilter } from "@/lib/studio/render-args";
import { studioSource } from "@/server/studio";

const srtTime = (s: number) => {
  const ms = Math.round(s * 1000), h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000), sec = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};
const srt = (cues: Cue[]) => cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(Math.max(c.end, c.start + 0.3))}\n${c.text.replace(/\r?\n+/g, " ").trim()}\n`).join("\n");

const progress = (id: string, detail: string) => db.renderJob.update({ where: { id }, data: { detail } });

/**
 * Renders a Studio edit list. Each clip becomes its own segment (exact cut, its speed, its blur boxes,
 * its captions), then the segments are joined without re-encoding. All text reaches FFmpeg through
 * files, never the command line; everything runs in a private temp folder.
 */
export async function runStudioRender(jobId: string) {
  const claim = await db.renderJob.updateMany({ where: { id: jobId, status: "queued", engine: "studio" }, data: { status: "running", detail: "Starting" } });
  if (!claim.count) return;
  const job = await db.renderJob.findUniqueOrThrow({ where: { id: jobId }, include: { project: true } });
  const p = job.project;
  const dir = await mkdtemp(path.join(os.tmpdir(), "elks-studio-"));
  try {
    const [row, source, script] = await Promise.all([
      db.studioEdit.findUnique({ where: { projectId: p.id } }),
      studioSource(p.id),
      db.scriptSegment.findMany({ where: { projectId: p.id }, orderBy: { order: "asc" } }),
    ]);
    if (!row || !source) throw new Error("This project has no Studio edit or no recording.");
    const edl = edlSchema.parse(JSON.parse(row.edl));
    const segments: Cue[] = script.map((s) => ({ start: s.startSec, end: s.endSec, text: s.text }));
    const out = path.join(dir, "out.mp4");

    await withLocalFile(source.storageKey, async (input) => {
      const { hasAudio } = await probeMedia(input);
      const names: string[] = [];
      for (const [i] of edl.clips.entries()) {
        await progress(job.id, `Rendering clip ${i + 1} of ${edl.clips.length}`);
        const cues = job.captions ? clipCues(edl, i, segments) : [];
        const captions = cues.length ? `clip-${i + 1}.srt` : null;
        if (captions) await writeFile(path.join(dir, captions), srt(cues), "utf8");
        const filterScript = `clip-${i + 1}.filter`;
        await writeFile(path.join(dir, filterScript), segmentFilter(edl, i, { hasAudio, captions }), "utf8");
        const name = `clip-${String(i + 1).padStart(3, "0")}.mp4`;
        await runFfmpeg(segmentArgs(edl, i, { input, hasAudio, captions, filterScript, output: name }), { cwd: dir });
        names.push(name);
      }
      await progress(job.id, "Joining the clips");
      await writeFile(path.join(dir, "clips.txt"), names.map((n) => `file '${n}'`).join("\n"), "utf8");
      await runFfmpeg(["-f", "concat", "-safe", "0", "-i", "clips.txt", "-c", "copy", "-movflags", "+faststart", "out.mp4"], { cwd: dir });
    });

    await progress(job.id, "Saving the video");
    const key = storageKeyFor(p.workspaceId, `${p.title.slice(0, 40)}-v${job.version}-studio.mp4`);
    await saveStream(key, createReadStream(out), "video/mp4");
    const durationSec = Math.round(await mediaDurationSec(out));
    await db.$transaction([
      db.renderJob.update({ where: { id: job.id }, data: { status: "succeeded", detail: "Done", outputKey: key, durationSec, sizeBytes: (await stat(out)).size, completedAt: new Date() } }),
      db.notification.create({ data: { userId: job.createdById, kind: "render.completed", title: "Studio video rendered", body: `${p.title} v${job.version} is ready to watch and download in Studio.`, href: `/projects/${p.id}/studio` } }),
      db.auditEvent.create({ data: { actorId: job.createdById, actorName: "EL Knowledge Studio (system)", action: "video.rendered", resourceType: "project", resourceId: p.id, resourceLabel: `${p.title} · Studio MP4 (${edl.clips.length} clips, ${edl.blurs.length} blurs)`, resourceVersion: job.version, workspaceId: p.workspaceId, outcome: "success", correlationId: job.id } }),
    ]);
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 300) : "Rendering failed.";
    await db.renderJob.update({ where: { id: job.id }, data: { status: "failed", detail: message, errorCode: "RENDER_FAILED", completedAt: new Date() } });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

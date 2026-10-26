import "server-only";
import { db } from "@/lib/database/client";
import { probeMedia } from "@/lib/services/local/ffmpeg";
import { withLocalFile } from "@/lib/services/storage";
import { defaultEdl, edlSchema, type Cue, type Edl } from "@/lib/studio/edl";

/** Studio (beta) is shown while the "studio-beta" feature flag is on. */
export async function studioEnabled() {
  return (await db.featureFlag.findUnique({ where: { key: "studio-beta" } }))?.enabled ?? false;
}

/**
 * The video Studio edits. Recordings and videos: the uploaded file. Audio and document projects have
 * no picture of their own, so Studio edits the video the Video tab rendered from them (audio over the
 * branded background, or the narrated pages); that render is pinned to the edit, so later Video tab
 * renders don't shift the edit under it. "Use the latest Video tab render" starts a fresh edit on a newer one.
 */
export interface StudioMedia {
  kind: "source" | "render";
  id: string;
  storageKey: string;
  words: string | null;
  mediaUrl: string;
  /** Caption cues in this video's time; null = the project's script timings (recordings). */
  cues: Cue[] | null;
  /** The captions are already part of the picture (a Video tab render of a recording or audio). */
  burnedCaptions: boolean;
  label: string;
}

const parseCues = (s: string | null): Cue[] | null => { try { return s ? (JSON.parse(s) as Cue[]) : null; } catch { return null; } };

export async function studioSource(projectId: string): Promise<StudioMedia | null> {
  const source = await db.sourceAsset.findFirst({ where: { projectId, storedBytes: true }, orderBy: { createdAt: "desc" } });
  if (source && ["recording", "video", "meeting"].includes(source.kind)) {
    return { kind: "source", id: source.id, storageKey: source.storageKey, words: source.words, mediaUrl: `/api/projects/${projectId}/media`, cues: null, burnedCaptions: false, label: source.fileName };
  }
  const edit = await db.studioEdit.findUnique({ where: { projectId }, select: { baseRenderId: true } });
  const render = edit?.baseRenderId
    ? await db.renderJob.findFirst({ where: { id: edit.baseRenderId, projectId, status: "succeeded" } })
    : await latestClassicRender(projectId);
  if (!render?.outputKey) return null;
  return {
    kind: "render", id: render.id, storageKey: render.outputKey, words: render.words, mediaUrl: `/api/projects/${projectId}/render?file=${render.id}`,
    cues: parseCues(render.cues), burnedCaptions: render.burnedCaptions, label: `Video tab render of v${render.version} (${render.language}${render.aiVoice ? ", AI voice" : ""})`,
  };
}

export const latestClassicRender = (projectId: string) =>
  db.renderJob.findFirst({ where: { projectId, engine: "classic", status: "succeeded", outputKey: { not: null } }, orderBy: { createdAt: "desc" } });

/** Saves word timings on whichever file Studio edits. */
export async function saveStudioWords(media: StudioMedia, words: string) {
  if (media.kind === "source") await db.sourceAsset.update({ where: { id: media.id }, data: { words } });
  else await db.renderJob.update({ where: { id: media.id }, data: { words } });
}

/**
 * The project's edit list, created on first open: one clip spanning the whole video. The length comes
 * from probing the file itself, because browser-made WEBM recordings often don't state it.
 */
export async function loadEdl(projectId: string, userId: string): Promise<{ edl: Edl; revision: number } | null> {
  const row = await db.studioEdit.findUnique({ where: { projectId } });
  if (row) {
    const parsed = edlSchema.safeParse(JSON.parse(row.edl));
    if (parsed.success) return { edl: parsed.data, revision: row.revision };
  }
  const media = await studioSource(projectId);
  if (!media) return null;
  return startEdl(projectId, userId, media);
}

/** A fresh edit list on `media` (pinning it when it's a render). */
export async function startEdl(projectId: string, userId: string, media: StudioMedia): Promise<{ edl: Edl; revision: number } | null> {
  const { durationSec } = await withLocalFile(media.storageKey, (f) => probeMedia(f));
  if (!durationSec) return null;
  const edl = defaultEdl(durationSec);
  const baseRenderId = media.kind === "render" ? media.id : null;
  const saved = await db.studioEdit.upsert({
    where: { projectId },
    create: { projectId, edl: JSON.stringify(edl), updatedById: userId, baseRenderId },
    update: { edl: JSON.stringify(edl), revision: { increment: 1 }, updatedById: userId, baseRenderId },
  });
  return { edl, revision: saved.revision };
}

/**
 * A job still "running" 30 minutes after it started died with its server process (a restart, or a
 * hang): mark it stopped so Studio unlocks and it can be started again. Checked whenever Studio
 * loads, polls or starts a job.
 */
export async function expireStaleStudioJobs(projectId: string) {
  await db.studioJob.updateMany({
    where: { projectId, status: { in: ["queued", "running"] }, createdAt: { lt: new Date(Date.now() - 30 * 60_000) } },
    data: { status: "failed", detail: "Stopped: this run didn't finish (the server restarted or it hung). Start it again.", completedAt: new Date() },
  });
}

export const STUDIO_JOB_KINDS = ["words", "pii", "zoom"] as const;
export type StudioJobKind = (typeof STUDIO_JOB_KINDS)[number];

/**
 * Captions Studio can show, per language: the project's language, plus every language with a
 * translated script (machine translations included; the Translations page marks what's reviewed).
 * Cues are in the edited video's source time; a translated cue keeps the original's timing.
 */
export async function studioCaptions(project: { id: string; primaryLanguage: string }, media: StudioMedia): Promise<Record<string, Cue[]>> {
  const [script, translated] = await Promise.all([
    db.scriptSegment.findMany({ where: { projectId: project.id }, orderBy: { order: "asc" }, select: { id: true, startSec: true, endSec: true, text: true } }),
    db.translationSegment.findMany({ where: { projectId: project.id, sourceType: "script" }, select: { language: true, sourceId: true, text: true } }),
  ]);
  const base: Cue[] = media.cues ?? script.map((s) => ({ start: s.startSec, end: s.endSec, text: s.text, ref: s.id }));
  const out: Record<string, Cue[]> = { [project.primaryLanguage]: base };
  const byLang = new Map<string, Map<string, string>>();
  for (const t of translated) { if (!byLang.has(t.language)) byLang.set(t.language, new Map()); byLang.get(t.language)!.set(t.sourceId, t.text); }
  for (const [lang, texts] of byLang) {
    if (lang === project.primaryLanguage) continue;
    out[lang] = base.map((c) => ({ ...c, text: (c.ref && texts.get(c.ref)) || c.text }));
  }
  return out;
}

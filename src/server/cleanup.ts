import "server-only";
import { db } from "@/lib/database/client";
import { deleteStoredFile, listStoredFiles, type StoredFileInfo } from "@/lib/services/storage";
import { parseCaptionTracks } from "@/lib/studio/render-meta";
import { getUploadedMusic } from "@/server/settings";

/**
 * Storage clean-up: files in storage that nothing in the database points to any more, e.g. an upload
 * whose wizard was abandoned, a recording replaced by a trimmed copy, or a screenshot captured again.
 * Anything modified within the window is never an orphan (an upload in progress, a wizard not finished,
 * a render that is being saved), and temporary "*.partial" files are left to the code writing them.
 */

const parseKeys = (s: string | null): string[] => { try { const v = s ? (JSON.parse(s) as unknown) : []; return Array.isArray(v) ? v.filter((k): k is string => typeof k === "string") : []; } catch { return []; } };

/** Every storage key the database refers to (soft-deleted projects included: they can still be restored). */
export async function referencedKeys(): Promise<Set<string>> {
  const [sources, renders, steps, music] = await Promise.all([
    db.sourceAsset.findMany({ select: { storageKey: true, pageImages: true } }),
    db.renderJob.findMany({ select: { outputKey: true, captionTracks: true } }),
    db.guideStep.findMany({ where: { screenshotKey: { not: null } }, select: { screenshotKey: true } }),
    getUploadedMusic(),
  ]);
  const keys = new Set<string>();
  for (const s of sources) { keys.add(s.storageKey); for (const k of parseKeys(s.pageImages)) keys.add(k); }
  for (const r of renders) { if (r.outputKey) keys.add(r.outputKey); for (const t of parseCaptionTracks(r.captionTracks)) keys.add(t.key); }
  for (const s of steps) if (s.screenshotKey) keys.add(s.screenshotKey);
  for (const t of music) keys.add(t.storageKey);
  return keys;
}

/** The pure rule, separate so it can be tested on its own. */
export function selectOrphans(files: StoredFileInfo[], referenced: Set<string>, olderThanHours: number, now = Date.now()): StoredFileInfo[] {
  const cutoff = now - olderThanHours * 3_600_000;
  return files.filter((f) => !f.key.endsWith(".partial") && !referenced.has(f.key) && f.modifiedAt.getTime() < cutoff);
}

export interface OrphanReport { count: number; totalBytes: number; oldest: Date | null; files: StoredFileInfo[] }

export async function findOrphans({ olderThanHours = 24 }: { olderThanHours?: number } = {}): Promise<OrphanReport> {
  const files = await listStoredFiles();
  const orphans = selectOrphans(files, await referencedKeys(), olderThanHours).sort((a, b) => a.modifiedAt.getTime() - b.modifiedAt.getTime());
  return { count: orphans.length, totalBytes: orphans.reduce((n, f) => n + f.size, 0), oldest: orphans[0]?.modifiedAt ?? null, files: orphans };
}

/**
 * Deletes the orphans. Storage and references are read again right now, so a file that became
 * referenced (or was touched) since the administrator looked is kept.
 */
export async function deleteOrphans({ olderThanHours = 24 }: { olderThanHours?: number } = {}): Promise<{ deleted: number; bytes: number; failed: number }> {
  const { files } = await findOrphans({ olderThanHours });
  let deleted = 0, bytes = 0, failed = 0;
  for (const f of files) {
    try { await deleteStoredFile(f.key); deleted++; bytes += f.size; } catch { failed++; }
  }
  return { deleted, bytes, failed };
}

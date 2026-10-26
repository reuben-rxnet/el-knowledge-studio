import "server-only";
import { db } from "@/lib/database/client";
import { probeMedia } from "@/lib/services/local/ffmpeg";
import { withLocalFile } from "@/lib/services/storage";
import { defaultEdl, edlSchema, type Edl } from "@/lib/studio/edl";

/** Studio (beta) is shown while the "studio-beta" feature flag is on. */
export async function studioEnabled() {
  return (await db.featureFlag.findUnique({ where: { key: "studio-beta" } }))?.enabled ?? false;
}

/** Studio edits recordings and videos (picture and sound). Audio-only and document projects use the Video tab. */
export async function studioSource(projectId: string) {
  const source = await db.sourceAsset.findFirst({ where: { projectId, storedBytes: true }, orderBy: { createdAt: "desc" } });
  return source && ["recording", "video", "meeting"].includes(source.kind) ? source : null;
}

/**
 * The project's edit list, created on first open: one clip spanning the whole recording. The length
 * comes from probing the file itself, because browser-made WEBM recordings often don't state it.
 */
export async function loadEdl(projectId: string, userId: string): Promise<{ edl: Edl; revision: number } | null> {
  const row = await db.studioEdit.findUnique({ where: { projectId } });
  if (row) {
    const parsed = edlSchema.safeParse(JSON.parse(row.edl));
    if (parsed.success) return { edl: parsed.data, revision: row.revision };
  }
  const source = await studioSource(projectId);
  if (!source) return null;
  const { durationSec } = await withLocalFile(source.storageKey, (f) => probeMedia(f));
  if (!durationSec) return null;
  const edl = defaultEdl(durationSec);
  const saved = await db.studioEdit.upsert({ where: { projectId }, create: { projectId, edl: JSON.stringify(edl), updatedById: userId }, update: { edl: JSON.stringify(edl), revision: { increment: 1 }, updatedById: userId } });
  return { edl, revision: saved.revision };
}

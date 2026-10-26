import "server-only";
import { db } from "@/lib/database/client";
import { pageImageSupport, renderPageImages } from "@/lib/services/local/slides";
import { saveFile, storageKeyFor, withLocalFile } from "@/lib/services/storage";

const inFlight = new Map<string, Promise<string[]>>();

export const pageKeysOf = (json: string | null | undefined): string[] => {
  try { const v = JSON.parse(json ?? "[]"); return Array.isArray(v) ? v.filter((k): k is string => typeof k === "string") : []; } catch { return []; }
};

/**
 * The page or slide images of a stored document, made once and kept in storage.
 * Returns [] when the file has no pages or this server can't render them (no LibreOffice for PPTX):
 * that result is not saved, so the images appear once LibreOffice is installed.
 */
export function ensurePageImages(sourceId: string): Promise<string[]> {
  const running = inFlight.get(sourceId);
  if (running) return running;
  const job = (async () => {
    const source = await db.sourceAsset.findUnique({ where: { id: sourceId }, include: { project: { select: { workspaceId: true } } } });
    if (!source?.storedBytes) return [];
    if (source.pageImages !== null) return pageKeysOf(source.pageImages);
    if (!pageImageSupport(source.fileName).ok) return [];
    const pngs = await withLocalFile(source.storageKey, (file) => renderPageImages(file, source.fileName));
    const keys: string[] = [];
    for (const [i, png] of pngs.entries()) {
      const key = storageKeyFor(source.project.workspaceId, `page-${String(i + 1).padStart(3, "0")}.png`);
      await saveFile(key, png, "image/png");
      keys.push(key);
    }
    await db.sourceAsset.update({ where: { id: source.id }, data: { pageImages: JSON.stringify(keys) } });
    return keys;
  })().finally(() => inFlight.delete(sourceId));
  inFlight.set(sourceId, job);
  return job;
}

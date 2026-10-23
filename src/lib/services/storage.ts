import "server-only";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";

/**
 * Local-disk storage adapter for the prototype (production: Azure Blob Storage per data region,
 * private containers, SAS per request). Keys are workspace-prefixed so a key from one workspace
 * can't be used in another, and paths are resolved inside STORAGE_DIR only (no traversal).
 */
const ROOT = path.resolve(/* turbopackIgnore: true */ process.env.STORAGE_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), "storage"));

export function storageKeyFor(workspaceId: string, fileName: string) {
  const safe = fileName.replace(/[^\w.-]+/g, "_").slice(-80);
  return `${workspaceId}/${randomUUID()}-${safe}`;
}

function resolveKey(key: string) {
  if (!/^[\w-]+\/[\w.-]+$/.test(key)) throw new Error("Invalid storage key.");
  const p = path.resolve(ROOT, key);
  if (!p.startsWith(ROOT + path.sep)) throw new Error("Invalid storage key.");
  return p;
}

export async function saveFile(key: string, data: Buffer) {
  const p = resolveKey(key);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, data);
}

export async function readStoredFile(key: string) {
  return readFile(resolveKey(key));
}

export async function storedFileExists(key: string) {
  try { return (await stat(resolveKey(key))).isFile(); } catch { return false; }
}

export const keyBelongsTo = (key: string, workspaceId: string) => key.startsWith(`${workspaceId}/`);

/** Size of a stored file, or null when it doesn't exist. */
export async function storedFileSize(key: string): Promise<number | null> {
  try { const s = await stat(resolveKey(key)); return s.isFile() ? s.size : null; } catch { return null; }
}

/** A byte range of a stored file as a web stream (for HTTP Range requests: seeking in video). */
export function streamStoredFile(key: string, start: number, end: number): ReadableStream<Uint8Array> {
  return Readable.toWeb(createReadStream(resolveKey(key), { start, end })) as ReadableStream<Uint8Array>;
}

/** Absolute path of a stored file, for tools that need a real file (FFmpeg). Never sent to clients. */
export const storedFilePath = (key: string) => resolveKey(key);

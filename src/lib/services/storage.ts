import "server-only";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import type { ContainerClient } from "@azure/storage-blob";

/**
 * File storage for uploads, recordings, screenshots and rendered videos.
 *   STORAGE_PROVIDER=local       files under STORAGE_DIR (development)
 *   STORAGE_PROVIDER=azure-blob  a private Blob container. In Azure the app's managed identity
 *                                authenticates (AZURE_STORAGE_ACCOUNT_URL); locally the Azurite emulator
 *                                (AZURE_STORAGE_CONNECTION_STRING). Shared keys are disabled in Azure.
 * Keys are workspace-prefixed ("<workspaceId>/<uuid>-<name>"), so a key from one workspace can't be
 * used in another, and they are validated before any path or blob name is built from them.
 */
const provider = () => (process.env.STORAGE_PROVIDER === "azure-blob" ? "azure-blob" : "local");
const ROOT = path.resolve(/* turbopackIgnore: true */ process.env.STORAGE_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), "storage"));

export function storageKeyFor(workspaceId: string, fileName: string) {
  const safe = fileName.replace(/[^\w.-]+/g, "_").slice(-80);
  return `${workspaceId}/${randomUUID()}-${safe}`;
}

export const keyBelongsTo = (key: string, workspaceId: string) => key.startsWith(`${workspaceId}/`);

function checkKey(key: string) {
  if (!/^[\w-]+\/[\w.-]+$/.test(key) || key.includes("..")) throw new Error("Invalid storage key.");
  return key;
}

function localPath(key: string) {
  const p = path.resolve(ROOT, checkKey(key));
  if (!p.startsWith(ROOT + path.sep)) throw new Error("Invalid storage key.");
  return p;
}

// --- Azure Blob ---------------------------------------------------------------------------

let container: Promise<ContainerClient> | null = null;
function blobContainer(): Promise<ContainerClient> {
  container ??= (async () => {
    const { BlobServiceClient } = await import("@azure/storage-blob");
    const name = process.env.AZURE_STORAGE_CONTAINER?.trim() || "media";
    const conn = process.env.AZURE_STORAGE_CONNECTION_STRING?.trim();
    let service;
    if (conn) {
      service = BlobServiceClient.fromConnectionString(conn);
    } else {
      const url = process.env.AZURE_STORAGE_ACCOUNT_URL?.trim();
      if (!url) throw new Error("Set AZURE_STORAGE_ACCOUNT_URL (managed identity) or AZURE_STORAGE_CONNECTION_STRING (emulator).");
      const { DefaultAzureCredential } = await import("@azure/identity");
      service = new BlobServiceClient(url, new DefaultAzureCredential());
    }
    const c = service.getContainerClient(name);
    // Azure creates the container in infra (Bicep); the emulator needs it created here. Always private.
    if (conn) await c.createIfNotExists();
    return c;
  })().catch((e) => { container = null; throw e; });
  return container;
}
const blob = async (key: string) => { const name = checkKey(key); return (await blobContainer()).getBlockBlobClient(name); };
const isNotFound = (e: unknown) => !!e && typeof e === "object" && "statusCode" in e && (e as { statusCode: number }).statusCode === 404;

// --- Operations (same behaviour on both providers) ----------------------------------------

export async function saveFile(key: string, data: Buffer, contentType = "application/octet-stream") {
  if (provider() === "azure-blob") { await (await blob(key)).uploadData(data, { blobHTTPHeaders: { blobContentType: contentType } }); return; }
  const p = localPath(key);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, data);
}

/**
 * Stores a stream without holding it in memory (uploads up to the per-type limit, e.g. 1 GB of video).
 * Local: written under a temporary name and renamed once complete. Blob: block upload in 8 MB pieces.
 * If the stream fails (too large, connection dropped) nothing is left behind.
 */
export async function saveStream(key: string, data: Readable, contentType = "application/octet-stream") {
  if (provider() === "azure-blob") {
    const b = await blob(key);
    try {
      await b.uploadStream(data, 8 * 1024 * 1024, 4, { blobHTTPHeaders: { blobContentType: contentType } });
    } catch (e) {
      await b.deleteIfExists().catch(() => {});
      throw e;
    }
    return;
  }
  const p = localPath(key);
  await mkdir(path.dirname(p), { recursive: true });
  const partial = `${p}.partial`;
  try {
    await pipeline(data, createWriteStream(partial));
    await rename(partial, p);
  } catch (e) {
    await rm(partial, { force: true }).catch(() => {});
    throw e;
  }
}

export async function deleteStoredFile(key: string) {
  if (provider() === "azure-blob") { await (await blob(key)).deleteIfExists(); return; }
  await rm(localPath(key), { force: true });
}

export async function readStoredFile(key: string): Promise<Buffer> {
  if (provider() === "azure-blob") return (await blob(key)).downloadToBuffer();
  return readFile(localPath(key));
}

export async function storedFileSize(key: string): Promise<number | null> {
  try {
    if (provider() === "azure-blob") return (await (await blob(key)).getProperties()).contentLength ?? null;
    const s = await stat(localPath(key));
    return s.isFile() ? s.size : null;
  } catch (e) {
    if (provider() === "azure-blob" && !isNotFound(e)) throw e;
    return null;
  }
}

export async function storedFileExists(key: string) {
  return (await storedFileSize(key)) !== null;
}

/** A byte range [start, end] as a web stream (HTTP Range requests: seeking in video). */
export async function streamStoredFile(key: string, start: number, end: number): Promise<ReadableStream<Uint8Array>> {
  if (provider() === "azure-blob") {
    const res = await (await blob(key)).download(start, end - start + 1);
    if (!res.readableStreamBody) throw new Error("Empty blob stream.");
    return Readable.toWeb(res.readableStreamBody as Readable) as ReadableStream<Uint8Array>;
  }
  return Readable.toWeb(createReadStream(localPath(key), { start, end })) as ReadableStream<Uint8Array>;
}

/**
 * Runs `fn` with a real file path, for tools that need one (FFmpeg, Whisper).
 * Local storage passes the stored file; Blob storage downloads a temporary copy that is deleted after.
 */
export async function withLocalFile<T>(key: string, fn: (filePath: string) => Promise<T>): Promise<T> {
  if (provider() === "local") return fn(localPath(key));
  const dir = await mkdtemp(path.join(os.tmpdir(), "elks-blob-"));
  const file = path.join(dir, path.basename(checkKey(key)));
  try {
    await (await blob(key)).downloadToFile(file);
    return await fn(file);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** For the health check: can storage be reached? */
export async function storageReady(): Promise<boolean> {
  try {
    if (provider() === "azure-blob") { await (await blobContainer()).getProperties(); return true; }
    await mkdir(ROOT, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

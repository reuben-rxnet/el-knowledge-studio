import "server-only";
import { storedFileSize, streamStoredFile } from "./storage";

/** Streams a stored file with HTTP Range support (seeking in video). Callers authorize first. */
export async function serveStoredFile(req: Request, key: string, contentType: string, downloadName?: string): Promise<Response | null> {
  const size = await storedFileSize(key);
  if (size === null) return null;
  const headers: Record<string, string> = { "content-type": contentType, "accept-ranges": "bytes", "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
  if (downloadName) headers["content-disposition"] = `attachment; filename="${downloadName.replace(/[^\w.-]+/g, "-")}"`;
  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (!range) return new Response(streamStoredFile(key, 0, size - 1), { status: 200, headers: { ...headers, "content-length": String(size) } });
  let start = range[1] ? Number(range[1]) : NaN;
  let end = range[2] ? Number(range[2]) : NaN;
  if (Number.isNaN(start)) { start = Math.max(0, size - end); end = size - 1; } // suffix range: last N bytes
  if (Number.isNaN(end) || end >= size) end = size - 1;
  if (start > end || start >= size) return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
  return new Response(streamStoredFile(key, start, end), { status: 206, headers: { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) } });
}

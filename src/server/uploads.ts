import "server-only";
import { createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { deleteStoredFile, saveStream, storageKeyFor } from "@/lib/services/storage";
import { AppError } from "@/lib/utilities/errors";

export interface StoredUpload { storageKey: string; fileName: string; mimeType: string; sizeBytes: number; checksum: string; durationSec?: number }

/**
 * Streams a file into the workspace's storage while counting and hashing it, so a 1 GB video never sits
 * in memory. Stops as soon as the file goes over its limit (the size the browser declares can't be
 * trusted) and leaves nothing behind.
 */
export async function storeStream(input: Readable, o: { workspaceId: string; fileName: string; mimeType: string; maxBytes: number; tooLarge: string }): Promise<StoredUpload> {
  const hash = createHash("sha256");
  let size = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _enc, done) {
      size += chunk.length;
      if (size > o.maxBytes) { done(new AppError("VALIDATION_FAILED", o.tooLarge, { reason: "TOO_LARGE" })); return; }
      hash.update(chunk);
      done(null, chunk);
    },
  });
  const storageKey = storageKeyFor(o.workspaceId, o.fileName);
  // Errors on either side end both: a dropped connection fails the upload, a full limit stops reading.
  input.on("error", (e) => meter.destroy(e));
  await saveStream(storageKey, input.pipe(meter), o.mimeType);
  if (size === 0) {
    await deleteStoredFile(storageKey).catch(() => {});
    throw new AppError("VALIDATION_FAILED", "This file is empty or damaged. Export it again from the original application.", { reason: "EMPTY_FILE" });
  }
  return { storageKey, fileName: o.fileName, mimeType: o.mimeType, sizeBytes: size, checksum: hash.digest("hex") };
}

import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { sessionSecret } from "@/lib/auth/session-cookie";
import { deleteStoredFile, keyBelongsTo, storedFileSize, streamStoredFile } from "@/lib/services/storage";
import { validateUpload } from "@/lib/validation/schemas";
import type { UploadLimits } from "@/lib/validation/upload-limits";
import { AppError } from "@/lib/utilities/errors";
import type { StoredUpload } from "@/server/uploads";

/**
 * Direct uploads (Blob storage): the browser writes the file straight to the container with a SAS URL,
 * then asks the app to "complete" it. The ticket handed out with the URL is signed by the app and names
 * the key, user, workspace, file name and type, so complete only accepts a blob this user was given a
 * URL for (not any key that happens to exist in the workspace, such as another project's recording).
 */
export interface UploadTicket { key: string; uid: string; ws: string; name: string; type: string; exp: number }

/** How long an upload may take in total. The SAS itself lasts 15 minutes and is renewed while it runs. */
export const TICKET_HOURS = 6;
/** Block size for Put Block: big enough for few requests, small enough to retry cheaply. */
export const DIRECT_BLOCK_BYTES = 8 * 1024 * 1024;

const mac = (body: string) => createHmac("sha256", sessionSecret()).update(`direct-upload:${body}`).digest();

export function signTicket(t: UploadTicket): string {
  const body = Buffer.from(JSON.stringify(t)).toString("base64url");
  return `${body}.${mac(body).toString("base64url")}`;
}

export function verifyTicket(token: unknown, now = Date.now()): UploadTicket | null {
  if (typeof token !== "string" || token.length > 2000) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const given = Buffer.from(sig, "base64url"), expected = mac(body);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const t = JSON.parse(Buffer.from(body, "base64url").toString()) as UploadTicket;
    return typeof t.key === "string" && typeof t.exp === "number" && t.exp >= now ? t : null;
  } catch {
    return null;
  }
}

/** The ticket must be this user's, in this workspace, for this key. */
export function ticketFor(token: unknown, session: { userId: string; workspaceId: string }, storageKey: unknown): UploadTicket {
  const t = verifyTicket(token);
  if (!t || t.key !== storageKey || t.uid !== session.userId || t.ws !== session.workspaceId || !keyBelongsTo(t.key, session.workspaceId)) {
    throw new AppError("VALIDATION_FAILED", "This upload link has expired or isn't yours. Choose the file again.");
  }
  return t;
}

/**
 * Checks the uploaded blob like /api/uploads checks a stream: it exists, isn't empty, is within its
 * type's limit (deleted if not), and is hashed (SHA-256) by streaming it, never held in memory.
 */
export async function completeDirectUpload(t: UploadTicket, limits: UploadLimits): Promise<StoredUpload & { kind: string }> {
  const size = await storedFileSize(t.key);
  if (size === null) throw new AppError("VALIDATION_FAILED", "The file didn't arrive in storage. Try the upload again.");
  const check = validateUpload({ name: t.name, type: t.type === "application/octet-stream" ? "" : t.type, size }, limits);
  if (!check.ok) {
    await deleteStoredFile(t.key).catch(() => {});
    throw new AppError("VALIDATION_FAILED", check.message, { reason: check.code });
  }
  const hash = createHash("sha256");
  const reader = (await streamStoredFile(t.key, 0, size - 1)).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hash.update(value);
  }
  return { storageKey: t.key, fileName: t.name, mimeType: t.type || "application/octet-stream", sizeBytes: size, checksum: hash.digest("hex"), kind: check.kind };
}

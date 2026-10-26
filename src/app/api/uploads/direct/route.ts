import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { directUploadsAvailable, directUploadUrl, storageKeyFor, storedFileSize } from "@/lib/services/storage";
import { validateUpload } from "@/lib/validation/schemas";
import { enforceRate } from "@/lib/utilities/rate-limit";
import { AppError, HTTP_STATUS, newCorrelationId, toApiError } from "@/lib/utilities/errors";
import { getUploadLimits } from "@/server/settings";
import { DIRECT_BLOCK_BYTES, signTicket, TICKET_HOURS, ticketFor } from "@/server/direct-upload";

export const dynamic = "force-dynamic";

const startSchema = z.object({ fileName: z.string().trim().min(1).max(200), mimeType: z.string().max(120), size: z.number().int().min(0) });
const renewSchema = z.object({ storageKey: z.string().max(300), ticket: z.string().max(2000) });

async function uploader() {
  const session = await getSession();
  if (!session) throw new AppError("UNAUTHENTICATED", "Your session has ended. Sign in again to continue.");
  if (!session.permissions.has("project.create")) throw new AppError("PERMISSION_DENIED", "Your role can't upload content.");
  return session;
}

const fail = (err: unknown, correlationId: ReturnType<typeof newCorrelationId>) => {
  if (!(err instanceof AppError)) console.error(`[uploads/direct] correlation=${correlationId}`, err instanceof Error ? err.name : "unknown");
  const body = toApiError(err, correlationId);
  return NextResponse.json(body, { status: HTTP_STATUS[body.code] });
};

/** GET → { enabled }: whether the browser should upload straight to Blob storage (production) or to POST /api/uploads. */
export async function GET() {
  const correlationId = newCorrelationId();
  try {
    await uploader();
    return NextResponse.json({ enabled: directUploadsAvailable(), blockBytes: DIRECT_BLOCK_BYTES }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return fail(err, correlationId);
  }
}

/**
 * POST { fileName, mimeType, size } → { storageKey, uploadUrl, expiresAt, ticket }: a 15-minute, create-only
 * SAS URL for exactly one new blob in the workspace's area. The same checks as /api/uploads run on the
 * declared size and type; complete checks the real size again.
 * POST { storageKey, ticket } → a fresh URL for the same blob, while a long upload is still running.
 */
export async function POST(req: Request) {
  const correlationId = newCorrelationId();
  try {
    const session = await uploader();
    if (!directUploadsAvailable()) throw new AppError("INVALID_STATE", "Direct uploads aren't used in this environment. Upload through /api/uploads.");
    const raw: unknown = await req.json().catch(() => null);
    const renew = renewSchema.safeParse(raw);
    if (renew.success) {
      const t = ticketFor(renew.data.ticket, { userId: session.user.id, workspaceId: session.workspace.id }, renew.data.storageKey);
      // Once the upload is committed, the blob is final: no new link to it.
      if ((await storedFileSize(t.key)) !== null) throw new AppError("INVALID_STATE", "This upload is already complete.");
      const { url, expiresOn } = await directUploadUrl(t.key);
      return NextResponse.json({ storageKey: t.key, uploadUrl: url, expiresAt: expiresOn.toISOString(), ticket: renew.data.ticket }, { headers: { "cache-control": "no-store" } });
    }
    enforceRate("upload", session.user.id);
    const parsed = startSchema.safeParse(raw);
    if (!parsed.success) throw new AppError("VALIDATION_FAILED", "No file was received. Choose the file again.");
    const v = parsed.data;
    const mimeType = v.mimeType.split(";")[0]!.trim();
    const limits = await getUploadLimits();
    const check = validateUpload({ name: v.fileName, type: mimeType === "application/octet-stream" ? "" : mimeType, size: v.size }, limits);
    if (!check.ok) throw new AppError("VALIDATION_FAILED", check.message, { reason: check.code });
    const storageKey = storageKeyFor(session.workspace.id, v.fileName);
    const { url, expiresOn } = await directUploadUrl(storageKey);
    const ticket = signTicket({ key: storageKey, uid: session.user.id, ws: session.workspace.id, name: v.fileName, type: mimeType || "application/octet-stream", exp: Date.now() + TICKET_HOURS * 3_600_000 });
    return NextResponse.json({ storageKey, uploadUrl: url, expiresAt: expiresOn.toISOString(), ticket, blockBytes: DIRECT_BLOCK_BYTES }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return fail(err, correlationId);
  }
}

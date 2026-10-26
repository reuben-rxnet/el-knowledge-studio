import { Readable } from "node:stream";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { tooLargeMessage, validateUpload } from "@/lib/validation/schemas";
import { categoryOf, MB } from "@/lib/validation/upload-limits";
import { enforceRate } from "@/lib/utilities/rate-limit";
import { AppError, HTTP_STATUS, newCorrelationId, toApiError } from "@/lib/utilities/errors";
import { getUploadLimits } from "@/server/settings";
import { storeStream } from "@/server/uploads";

export const dynamic = "force-dynamic";

/**
 * Stores an uploaded source file in the workspace's storage area and returns an opaque key.
 * The browser sends the file itself as the request body (not a form), with its name in X-File-Name,
 * so the server can stream it to storage at any size. The key is only accepted later by createProject
 * for the same workspace.
 */
export async function POST(req: Request) {
  const correlationId = newCorrelationId();
  try {
    const session = await getSession();
    if (!session) throw new AppError("UNAUTHENTICATED", "Your session has ended. Sign in again to continue.");
    if (!session.permissions.has("project.create")) throw new AppError("PERMISSION_DENIED", "Your role can't upload content.");
    enforceRate("upload", session.user.id);
    let fileName = "";
    try { fileName = decodeURIComponent(req.headers.get("x-file-name") ?? "").trim(); } catch { fileName = ""; }
    if (!fileName || fileName.length > 200 || !req.body) throw new AppError("VALIDATION_FAILED", "No file was received. Choose the file again.");
    const mimeType = (req.headers.get("content-type") ?? "").split(";")[0]!.trim();
    const limits = await getUploadLimits();
    // Checked up front with the declared size, then enforced again while the bytes arrive.
    const declared = Number(req.headers.get("content-length") ?? "1") || 1;
    const check = validateUpload({ name: fileName, type: mimeType === "application/octet-stream" ? "" : mimeType, size: declared }, limits);
    if (!check.ok) throw new AppError("VALIDATION_FAILED", check.message, { reason: check.code });
    const stored = await storeStream(Readable.fromWeb(req.body as unknown as NodeWebStream), {
      workspaceId: session.workspace.id, fileName, mimeType: mimeType || "application/octet-stream",
      maxBytes: limits[categoryOf(fileName)!] * MB, tooLarge: tooLargeMessage(fileName, null, limits),
    });
    return NextResponse.json({ ...stored, kind: check.kind });
  } catch (err) {
    if (!(err instanceof AppError)) console.error(`[uploads] correlation=${correlationId}`, err instanceof Error ? err.name : "unknown");
    const body = toApiError(err, correlationId);
    return NextResponse.json(body, { status: HTTP_STATUS[body.code] });
  }
}

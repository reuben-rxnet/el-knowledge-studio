import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { saveFile, storageKeyFor } from "@/lib/services/storage";
import { validateUpload } from "@/lib/validation/schemas";
import { AppError, HTTP_STATUS, newCorrelationId, toApiError } from "@/lib/utilities/errors";

export const dynamic = "force-dynamic";

/** Local prototype limit; files are held in memory while stored. Production streams to Blob Storage. */
const LOCAL_MAX_BYTES = Number(process.env.LOCAL_UPLOAD_MAX_MB ?? 200) * 1024 * 1024;

/**
 * Stores an uploaded source file in the workspace's storage area and returns an opaque key.
 * The key is only accepted later by createProject for the same workspace.
 */
export async function POST(req: Request) {
  const correlationId = newCorrelationId();
  try {
    const session = await getSession();
    if (!session) throw new AppError("UNAUTHENTICATED", "Your session has ended. Sign in again to continue.");
    if (!session.permissions.has("project.create")) throw new AppError("PERMISSION_DENIED", "Your role can't upload content.");
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new AppError("VALIDATION_FAILED", "No file was received. Choose the file again.");
    const check = validateUpload({ name: file.name, type: file.type, size: file.size }, LOCAL_MAX_BYTES);
    if (!check.ok) throw new AppError("VALIDATION_FAILED", check.message, { reason: check.code });
    const buf = Buffer.from(await file.arrayBuffer());
    const storageKey = storageKeyFor(session.workspace.id, file.name);
    await saveFile(storageKey, buf);
    return NextResponse.json({
      storageKey,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      checksum: createHash("sha256").update(buf).digest("hex"),
      kind: check.kind,
    });
  } catch (err) {
    const body = toApiError(err, correlationId);
    return NextResponse.json(body, { status: HTTP_STATUS[body.code] });
  }
}

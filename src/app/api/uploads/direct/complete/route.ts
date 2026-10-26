import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { directUploadsAvailable } from "@/lib/services/storage";
import { AppError, HTTP_STATUS, newCorrelationId, toApiError } from "@/lib/utilities/errors";
import { getUploadLimits } from "@/server/settings";
import { completeDirectUpload, ticketFor } from "@/server/direct-upload";

export const dynamic = "force-dynamic";

const schema = z.object({ storageKey: z.string().max(300), ticket: z.string().max(2000) });

/**
 * POST { storageKey, ticket } after the browser has written the file to Blob storage. Checks the blob
 * (exists, real size within its type's limit, else deleted), hashes it, and returns the same shape as
 * POST /api/uploads, so creating the project works the same way afterwards.
 */
export async function POST(req: Request) {
  const correlationId = newCorrelationId();
  try {
    const session = await getSession();
    if (!session) throw new AppError("UNAUTHENTICATED", "Your session has ended. Sign in again to continue.");
    if (!session.permissions.has("project.create")) throw new AppError("PERMISSION_DENIED", "Your role can't upload content.");
    if (!directUploadsAvailable()) throw new AppError("INVALID_STATE", "Direct uploads aren't used in this environment.");
    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new AppError("VALIDATION_FAILED", "No upload was named. Choose the file again.");
    const t = ticketFor(parsed.data.ticket, { userId: session.user.id, workspaceId: session.workspace.id }, parsed.data.storageKey);
    return NextResponse.json(await completeDirectUpload(t, await getUploadLimits()));
  } catch (err) {
    if (!(err instanceof AppError)) console.error(`[uploads/direct/complete] correlation=${correlationId}`, err instanceof Error ? err.name : "unknown");
    const body = toApiError(err, correlationId);
    return NextResponse.json(body, { status: HTTP_STATUS[body.code] });
  }
}

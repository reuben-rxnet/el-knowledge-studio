import { NextResponse } from "next/server";
import { db } from "@/lib/database/client";
import { getSession } from "@/lib/auth/session";
import { isMediaSource } from "@/lib/domain/constants";
import { serveStoredFile } from "@/lib/services/serve-file";
import { AppError, HTTP_STATUS, newCorrelationId, toApiError } from "@/lib/utilities/errors";

export const dynamic = "force-dynamic";

/**
 * Streams the project's recording or video with HTTP Range support, so the player can seek.
 * Authorization on every request: a session, project.view, and the project in the active workspace.
 * Production: a short-lived Blob Storage SAS URL issued here instead of proxying the bytes.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const session = await getSession();
    if (!session) throw new AppError("UNAUTHENTICATED", "Your session has ended. Sign in again to continue.");
    if (!session.permissions.has("project.view")) throw new AppError("PERMISSION_DENIED", "Your role can't view this content.");
    const { id } = await ctx.params;
    const project = await db.project.findFirst({ where: { id, workspaceId: session.workspace.id, deletedAt: null }, select: { id: true, sourceKind: true } });
    if (!project) throw new AppError("PROJECT_NOT_FOUND", "The requested project could not be found.");
    const source = await db.sourceAsset.findFirst({ where: { projectId: project.id, storedBytes: true }, orderBy: { createdAt: "desc" } });
    if (!source || !isMediaSource(source.kind)) throw new AppError("PROJECT_NOT_FOUND", "This project has no recording to play.");
    const res = await serveStoredFile(req, source.storageKey, source.mimeType || "video/webm");
    if (!res) throw new AppError("PROJECT_NOT_FOUND", "The recording file is missing from storage.");
    return res;
  } catch (err) {
    const body = toApiError(err, correlationId);
    return NextResponse.json(body, { status: HTTP_STATUS[body.code] });
  }
}

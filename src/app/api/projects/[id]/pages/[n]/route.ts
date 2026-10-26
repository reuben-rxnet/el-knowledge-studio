import { NextResponse } from "next/server";
import { db } from "@/lib/database/client";
import { getSession } from "@/lib/auth/session";
import { readStoredFile } from "@/lib/services/storage";
import { AppError, HTTP_STATUS, newCorrelationId, toApiError } from "@/lib/utilities/errors";
import { pageKeysOf } from "@/server/jobs/page-images";

export const dynamic = "force-dynamic";

/** One page or slide image (PNG) of the project's document, for anyone who can view the project. n is 1-based. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; n: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const session = await getSession();
    if (!session) throw new AppError("UNAUTHENTICATED", "Your session has ended. Sign in again to continue.");
    if (!session.permissions.has("project.view")) throw new AppError("PERMISSION_DENIED", "Your role can't view this content.");
    const { id, n } = await ctx.params;
    const project = await db.project.findFirst({ where: { id, workspaceId: session.workspace.id, deletedAt: null }, select: { id: true } });
    if (!project) throw new AppError("PROJECT_NOT_FOUND", "The requested project could not be found.");
    const source = await db.sourceAsset.findFirst({ where: { projectId: project.id, storedBytes: true }, orderBy: { createdAt: "desc" } });
    const key = pageKeysOf(source?.pageImages)[Number(n) - 1];
    if (!/^\d+$/.test(n) || !key) throw new AppError("PROJECT_NOT_FOUND", "That page image doesn't exist.");
    return new Response(new Uint8Array(await readStoredFile(key)), { headers: { "content-type": "image/png", "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });
  } catch (err) {
    const body = toApiError(err, correlationId);
    return NextResponse.json(body, { status: HTTP_STATUS[body.code] });
  }
}

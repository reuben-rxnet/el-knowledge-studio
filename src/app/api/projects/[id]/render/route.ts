import { NextResponse } from "next/server";
import { db } from "@/lib/database/client";
import { getSession } from "@/lib/auth/session";
import { serveStoredFile } from "@/lib/services/serve-file";
import { AppError, HTTP_STATUS, newCorrelationId, toApiError } from "@/lib/utilities/errors";

export const dynamic = "force-dynamic";

/**
 * GET                  → status of the latest renders (JSON): Video tab renders, or ?engine=studio for Studio's
 * GET ?file=<renderId> → the rendered MP4 (Range supported; &download=1 to save it)
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) throw new AppError("UNAUTHENTICATED", "Your session has ended. Sign in again to continue.");
    const { id } = await ctx.params;
    const project = await db.project.findFirst({ where: { id, workspaceId: session.workspace.id, deletedAt: null }, select: { id: true, title: true, classification: true } });
    if (!project) throw new AppError("PROJECT_NOT_FOUND", "The requested project could not be found.");
    const url = new URL(req.url);
    const fileId = url.searchParams.get("file");
    if (fileId) {
      const r = await db.renderJob.findFirst({ where: { id: fileId, projectId: project.id, status: "succeeded" } });
      if (!r?.outputKey) throw new AppError("PROJECT_NOT_FOUND", "That rendered video isn't available.");
      const download = url.searchParams.get("download");
      // Classification policy: downloads of Confidential and above need the download permission.
      if (download && ["Confidential", "Highly Confidential", "Restricted"].includes(project.classification) && !session.permissions.has("recording.download")) {
        throw new AppError("PERMISSION_DENIED", `${project.classification} videos can't be downloaded with your role.`);
      }
      const res = await serveStoredFile(req, r.outputKey, "video/mp4", download ? `${project.title}-v${r.version}-${r.engine === "studio" ? "studio" : r.language}.mp4` : undefined);
      if (!res) throw new AppError("PROJECT_NOT_FOUND", "The rendered file is missing from storage.");
      return res;
    }
    const engine = url.searchParams.get("engine") === "studio" ? "studio" : "classic";
    const renders = await db.renderJob.findMany({ where: { projectId: project.id, engine }, orderBy: { createdAt: "desc" }, take: 5 });
    return NextResponse.json({ renders: renders.map((r) => ({ id: r.id, status: r.status, detail: r.detail, language: r.language, aiVoice: r.aiVoice, engine: r.engine, version: r.version, durationSec: r.durationSec, sizeBytes: r.sizeBytes, createdAt: r.createdAt })) }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const body = toApiError(err, newCorrelationId());
    return NextResponse.json(body, { status: HTTP_STATUS[body.code] });
  }
}

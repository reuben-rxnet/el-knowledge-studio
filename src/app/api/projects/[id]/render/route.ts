import { NextResponse } from "next/server";
import { db } from "@/lib/database/client";
import { getSession } from "@/lib/auth/session";
import { readStoredFile } from "@/lib/services/storage";
import { serveStoredFile } from "@/lib/services/serve-file";
import { parseCaptionTracks, parseChapters } from "@/lib/studio/render-meta";
import { AppError, HTTP_STATUS, newCorrelationId, toApiError } from "@/lib/utilities/errors";

export const dynamic = "force-dynamic";

const PROTECTED = ["Confidential", "Highly Confidential", "Restricted"];

/**
 * GET                           → status of the latest renders (JSON): Video tab renders, or ?engine=studio for Studio's.
 *                                 Each says whether it is the video chosen for publishing (`official`) and can be chosen.
 * GET ?file=<renderId>          → the rendered MP4 (Range supported; &download=1 to save it)
 * GET ?file=<renderId>&vtt=<lg> → the subtitles stored with that render, as WebVTT (&download=1 to save them)
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) throw new AppError("UNAUTHENTICATED", "Your session has ended. Sign in again to continue.");
    const { id } = await ctx.params;
    const project = await db.project.findFirst({ where: { id, workspaceId: session.workspace.id, deletedAt: null }, select: { id: true, title: true, classification: true, approvedVersion: true, currentVersion: true } });
    if (!project) throw new AppError("PROJECT_NOT_FOUND", "The requested project could not be found.");
    const url = new URL(req.url);
    const fileId = url.searchParams.get("file");
    if (fileId) {
      const r = await db.renderJob.findFirst({ where: { id: fileId, projectId: project.id, status: "succeeded" } });
      if (!r?.outputKey) throw new AppError("PROJECT_NOT_FOUND", "That rendered video isn't available.");
      const download = url.searchParams.get("download");
      // Classification policy: downloads of Confidential and above need the download permission.
      if (download && PROTECTED.includes(project.classification) && !session.permissions.has("recording.download")) {
        throw new AppError("PERMISSION_DENIED", `${project.classification} videos can't be downloaded with your role.`);
      }
      const base = `${project.title}-v${r.version}-${r.engine === "studio" ? "studio" : r.language}`;
      const lang = url.searchParams.get("vtt");
      if (lang) {
        const track = parseCaptionTracks(r.captionTracks).find((t) => t.language === lang);
        if (!track) throw new AppError("PROJECT_NOT_FOUND", "There are no subtitles in that language for this video.");
        const text = await readStoredFile(track.key).catch(() => null);
        if (!text) throw new AppError("PROJECT_NOT_FOUND", "The subtitle file is missing from storage.");
        const headers: Record<string, string> = { "content-type": "text/vtt; charset=utf-8", "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
        if (download) headers["content-disposition"] = `attachment; filename="${`${base}.${lang}.vtt`.replace(/[^\w.-]+/g, "-")}"`;
        return new Response(new Uint8Array(text), { status: 200, headers });
      }
      const res = await serveStoredFile(req, r.outputKey, "video/mp4", download ? `${base}.mp4` : undefined);
      if (!res) throw new AppError("PROJECT_NOT_FOUND", "The rendered file is missing from storage.");
      return res;
    }
    const engine = url.searchParams.get("engine") === "studio" ? "studio" : "classic";
    const [renders, versions] = await Promise.all([
      db.renderJob.findMany({ where: { projectId: project.id, engine }, orderBy: { createdAt: "desc" }, take: 5 }),
      db.projectVersion.findMany({ where: { projectId: project.id, officialRenderId: { not: null } }, select: { officialRenderId: true } }),
    ]);
    const official = new Set(versions.map((v) => v.officialRenderId));
    const canChoose = session.permissions.has("publish.execute") || session.permissions.has("project.edit");
    return NextResponse.json({
      canChoose,
      renders: renders.map((r) => ({
        id: r.id, status: r.status, detail: r.detail, language: r.language, aiVoice: r.aiVoice, engine: r.engine, version: r.version, durationSec: r.durationSec, sizeBytes: r.sizeBytes, createdAt: r.createdAt,
        official: official.has(r.id),
        choosable: r.status === "succeeded" && (r.version === project.approvedVersion || r.version === project.currentVersion),
        chapters: parseChapters(r.chapters),
        captionLanguages: parseCaptionTracks(r.captionTracks).map((t) => t.language),
      })),
    }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const body = toApiError(err, newCorrelationId());
    return NextResponse.json(body, { status: HTTP_STATUS[body.code] });
  }
}

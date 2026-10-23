import { NextResponse } from "next/server";
import { db } from "@/lib/database/client";
import { getSession } from "@/lib/auth/session";
import { AppError, HTTP_STATUS, newCorrelationId, toApiError } from "@/lib/utilities/errors";

export const dynamic = "force-dynamic";

const ts = (sec: number) => {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60), ms = Math.round((sec % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
};
/** WebVTT cue text can't contain "-->" or start a line with a blank. */
const cueText = (t: string) => t.replace(/-->/g, "→").replace(/\r?\n+/g, " ").trim();

/**
 * WebVTT captions from the script, in the primary language or any translated language (?lang=fr).
 * Used by the player's <track>, and downloadable for Microsoft Stream or Teams (?download=1).
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const session = await getSession();
    if (!session) throw new AppError("UNAUTHENTICATED", "Your session has ended. Sign in again to continue.");
    const { id } = await ctx.params;
    const url = new URL(req.url);
    const lang = url.searchParams.get("lang");
    const project = await db.project.findFirst({ where: { id, workspaceId: session.workspace.id, deletedAt: null }, select: { id: true, title: true, primaryLanguage: true } });
    if (!project) throw new AppError("PROJECT_NOT_FOUND", "The requested project could not be found.");
    const script = await db.scriptSegment.findMany({ where: { projectId: project.id }, orderBy: { order: "asc" } });
    const translated = lang && lang !== project.primaryLanguage
      ? new Map((await db.translationSegment.findMany({ where: { projectId: project.id, language: lang, sourceType: "script" } })).map((t) => [t.sourceId, t.text]))
      : null;
    if (translated && !translated.size) throw new AppError("PROJECT_NOT_FOUND", "There are no captions in that language yet.");
    const lines = ["WEBVTT", "", ...script.flatMap((s, i) => [String(i + 1), `${ts(s.startSec)} --> ${ts(Math.max(s.endSec, s.startSec + 1))}`, cueText(translated?.get(s.id) ?? s.text), ""])];
    const headers: Record<string, string> = { "content-type": "text/vtt; charset=utf-8", "cache-control": "private, no-store" };
    if (url.searchParams.get("download")) headers["content-disposition"] = `attachment; filename="${project.title.replace(/[^\w-]+/g, "-").slice(0, 60)}.${lang ?? project.primaryLanguage}.vtt"`;
    return new Response(lines.join("\n"), { headers });
  } catch (err) {
    const body = toApiError(err, correlationId);
    return NextResponse.json(body, { status: HTTP_STATUS[body.code] });
  }
}

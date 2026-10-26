import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { serveStoredFile } from "@/lib/services/serve-file";
import { AppError, HTTP_STATUS, newCorrelationId, toApiError } from "@/lib/utilities/errors";
import { getUploadedMusic } from "@/server/settings";

export const dynamic = "force-dynamic";

/** Plays an uploaded music track (signed-in users; Studio previews it). Range requests are supported. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) throw new AppError("UNAUTHENTICATED", "Your session has ended. Sign in again to continue.");
    const { id } = await ctx.params;
    const track = (await getUploadedMusic()).find((t) => t.id === id);
    if (!track) throw new AppError("PROJECT_NOT_FOUND", "That music track isn't in the library.");
    const ext = track.storageKey.split(".").pop()?.toLowerCase();
    const type = ext === "mp3" ? "audio/mpeg" : ext === "wav" ? "audio/wav" : ext === "aac" ? "audio/aac" : "audio/mp4";
    const res = await serveStoredFile(req, track.storageKey, type);
    if (!res) throw new AppError("PROJECT_NOT_FOUND", "The track's file is missing from storage.");
    return res;
  } catch (err) {
    const body = toApiError(err, newCorrelationId());
    return NextResponse.json(body, { status: HTTP_STATUS[body.code] });
  }
}

import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { db } from "@/lib/database/client";
import { getSession } from "@/lib/auth/session";
import { probeMedia, runFfmpeg } from "@/lib/services/local/ffmpeg";
import { withLocalFile } from "@/lib/services/storage";
import { STRIP_TILE, stripCount, stripStep, WAVE_SIZE } from "@/lib/studio/strip";
import { AppError, HTTP_STATUS, newCorrelationId, toApiError } from "@/lib/utilities/errors";
import { studioSource } from "@/server/studio";

export const dynamic = "force-dynamic";

const CACHE = path.join(os.tmpdir(), "elks-studio-strips");
const making = new Map<string, Promise<void>>();

/**
 * GET ?kind=frames  the filmstrip of the video Studio edits (JPEG, tiles laid out as lib/studio/strip.ts says)
 * GET ?kind=wave    its waveform (PNG, transparent), or 404 when the video has no sound
 * Made once per video with FFmpeg and kept in a temp folder (they're derived, so losing them is fine).
 * Same authorization as Studio: a session with project.edit and the project in the active workspace.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) throw new AppError("UNAUTHENTICATED", "Your session has ended. Sign in again to continue.");
    if (!session.permissions.has("project.edit")) throw new AppError("PERMISSION_DENIED", "Your role can't edit this content.");
    const { id } = await ctx.params;
    const project = await db.project.findFirst({ where: { id, workspaceId: session.workspace.id, deletedAt: null }, select: { id: true } });
    if (!project) throw new AppError("PROJECT_NOT_FOUND", "The requested project could not be found.");
    const kind = new URL(req.url).searchParams.get("kind") === "wave" ? "wave" : "frames";
    const media = await studioSource(project.id);
    if (!media) throw new AppError("PROJECT_NOT_FOUND", "This project has no video for Studio.");
    if (!/^[\w-]+$/.test(media.id)) throw new AppError("INVALID_STATE", "Unexpected video id.");
    const file = path.join(CACHE, `${media.id}-${kind}.${kind === "wave" ? "png" : "jpg"}`);
    const none = path.join(CACHE, `${media.id}-${kind}.none`);
    if (!existsSync(file) && !existsSync(none)) {
      let job = making.get(file);
      if (!job) {
        job = make(media.storageKey, kind, file, none).finally(() => making.delete(file));
        making.set(file, job);
      }
      await job;
    }
    if (!existsSync(file)) return new NextResponse(null, { status: 404 });
    return new NextResponse(new Uint8Array(await readFile(file)), { headers: { "content-type": kind === "wave" ? "image/png" : "image/jpeg", "cache-control": "private, max-age=3600" } });
  } catch (err) {
    const body = toApiError(err, newCorrelationId());
    return NextResponse.json(body, { status: HTTP_STATUS[body.code] });
  }
}

async function make(storageKey: string, kind: "frames" | "wave", file: string, none: string) {
  await mkdir(CACHE, { recursive: true });
  await withLocalFile(storageKey, async (input) => {
    const info = await probeMedia(input);
    const tmp = `${file}.part${path.extname(file)}`;
    if (kind === "wave") {
      if (!info.hasAudio) { await writeFile(none, ""); return; }
      await runFfmpeg(["-i", input, "-filter_complex", `[0:a]aformat=channel_layouts=mono,showwavespic=s=${WAVE_SIZE.w}x${WAVE_SIZE.h}:colors=0x7FDAF0:scale=sqrt:draw=full`, "-frames:v", "1", tmp]);
    } else {
      const n = stripCount(info.durationSec), rows = Math.ceil(n / STRIP_TILE.cols);
      const { w, h, cols } = STRIP_TILE;
      await runFfmpeg(["-i", input, "-vf", `fps=1/${stripStep(info.durationSec).toFixed(4)},scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,tile=${cols}x${rows}`, "-frames:v", "1", "-q:v", "4", tmp]);
    }
    await rename(tmp, file);
  });
}

import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { mediaDurationSec, runFfmpeg } from "@/lib/services/local/ffmpeg";
import { keyBelongsTo, storedFileExists, withLocalFile } from "@/lib/services/storage";
import { categoryOf, MB } from "@/lib/validation/upload-limits";
import { tooLargeMessage } from "@/lib/validation/schemas";
import { enforceRate } from "@/lib/utilities/rate-limit";
import { AppError, HTTP_STATUS, newCorrelationId, toApiError } from "@/lib/utilities/errors";
import { recordAudit } from "@/server/audit";
import { getUploadLimits } from "@/server/settings";
import { storeStream, type StoredUpload } from "@/server/uploads";

export const dynamic = "force-dynamic";

const MAX_PARTS = 20;
const MIN_PART_SEC = 5;
const body = z.object({
  storageKey: z.string().min(3).max(200),
  fileName: z.string().min(1).max(200),
  mimeType: z.string().max(120),
  /** One cut = trim; several = split into parts. Seconds from the start of the file. */
  cuts: z.array(z.object({ startSec: z.number().min(0), endSec: z.number().positive() })).min(1).max(MAX_PARTS),
});

/**
 * Trims an uploaded video or audio file, or splits it into parts, before a project is made from it.
 * FFmpeg copies the selected stretches without re-encoding (fast, full quality); a cut lands on the
 * nearest keyframe, usually within a second or two. The original upload is kept, so the creator can
 * change their mind.
 */
export async function POST(req: Request) {
  const correlationId = newCorrelationId();
  try {
    const session = await getSession();
    if (!session) throw new AppError("UNAUTHENTICATED", "Your session has ended. Sign in again to continue.");
    if (!session.permissions.has("project.create")) throw new AppError("PERMISSION_DENIED", "Your role can't upload content.");
    const v = body.parse(await req.json().catch(() => ({})));
    const category = categoryOf(v.fileName);
    if (category !== "video" && category !== "audio") throw new AppError("VALIDATION_FAILED", "Only video and audio files can be trimmed or split.");
    if (!keyBelongsTo(v.storageKey, session.workspace.id) || !(await storedFileExists(v.storageKey))) throw new AppError("VALIDATION_FAILED", "The uploaded file couldn't be found. Upload it again.");
    enforceRate("upload", session.user.id);
    const limits = await getUploadLimits();
    const ext = path.extname(v.fileName).toLowerCase();
    const base = path.basename(v.fileName, path.extname(v.fileName));
    const cuts = [...v.cuts].sort((a, b) => a.startSec - b.startSec);

    const parts = await withLocalFile(v.storageKey, async (input) => {
      const length = await mediaDurationSec(input);
      for (const [i, c] of cuts.entries()) {
        if (c.endSec <= c.startSec) throw new AppError("VALIDATION_FAILED", `Part ${i + 1} ends before it starts.`);
        if (length && c.startSec >= length) throw new AppError("VALIDATION_FAILED", `Part ${i + 1} starts after the end of the file (${Math.floor(length)} s).`);
        if (Math.min(c.endSec, length || c.endSec) - c.startSec < MIN_PART_SEC) throw new AppError("VALIDATION_FAILED", `Part ${i + 1} is shorter than ${MIN_PART_SEC} seconds.`);
        if (i > 0 && c.startSec < cuts[i - 1]!.endSec) throw new AppError("VALIDATION_FAILED", `Parts ${i} and ${i + 1} overlap.`);
      }
      const dir = await mkdtemp(path.join(os.tmpdir(), "elks-cut-"));
      try {
        const out: StoredUpload[] = [];
        for (const [i, c] of cuts.entries()) {
          const end = length ? Math.min(c.endSec, length) : c.endSec;
          const file = path.join(dir, `part-${i + 1}${ext}`);
          await runFfmpeg(["-ss", c.startSec.toFixed(2), "-i", input, "-t", (end - c.startSec).toFixed(2), "-map", "0", "-c", "copy", "-avoid_negative_ts", "make_zero", file]);
          const name = cuts.length === 1 ? `${base} (trimmed)${ext}` : `${base} (part ${i + 1} of ${cuts.length})${ext}`;
          const stored = await storeStream(createReadStream(file), { workspaceId: session.workspace.id, fileName: name, mimeType: v.mimeType || "application/octet-stream", maxBytes: limits[category] * MB, tooLarge: tooLargeMessage(name, null, limits) });
          out.push({ ...stored, durationSec: Math.round(await mediaDurationSec(file)) });
        }
        return out;
      } finally {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    });
    await recordAudit(session, { action: "source.edited", resourceType: "upload", resourceId: v.storageKey, resourceLabel: cuts.length === 1 ? `Trimmed ${v.fileName}` : `Split ${v.fileName} into ${cuts.length} parts` });
    return NextResponse.json({ parts });
  } catch (err) {
    if (!(err instanceof AppError) && !(err instanceof z.ZodError)) console.error(`[uploads/edit] correlation=${correlationId}`, err instanceof Error ? err.name : "unknown");
    const e = err instanceof z.ZodError ? new AppError("VALIDATION_FAILED", "Check the start and end times of each part.") : err;
    const res = toApiError(e, correlationId);
    return NextResponse.json(res, { status: HTTP_STATUS[res.code] });
  }
}

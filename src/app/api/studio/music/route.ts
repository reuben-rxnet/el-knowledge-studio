import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebStream } from "node:stream/web";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { MB } from "@/lib/validation/upload-limits";
import { enforceRate } from "@/lib/utilities/rate-limit";
import { AppError, HTTP_STATUS, newCorrelationId, toApiError } from "@/lib/utilities/errors";
import { recordAudit } from "@/server/audit";
import { getUploadedMusic, storeUploadedMusic } from "@/server/settings";
import { storeStream } from "@/server/uploads";

export const dynamic = "force-dynamic";
const TYPES: Record<string, string> = { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav" };
const MAX_TRACKS = 30;

/**
 * Adds a music track the company has licensed to Studio's library (brand administrators only).
 * The file is the request body, its name in X-File-Name, its title and licence in X-Track-Title and
 * X-Track-Licence (both required: the licence note says where the right to use it comes from).
 * Tracks are platform-wide, stored under "platform/".
 */
export async function POST(req: Request) {
  const correlationId = newCorrelationId();
  try {
    const session = await getSession();
    if (!session) throw new AppError("UNAUTHENTICATED", "Your session has ended. Sign in again to continue.");
    if (!session.permissions.has("brand.manage")) throw new AppError("PERMISSION_DENIED", "Only brand administrators can add music.");
    enforceRate("upload", session.user.id);
    const header = (name: string) => { try { return decodeURIComponent(req.headers.get(name) ?? "").trim(); } catch { return ""; } };
    const fileName = header("x-file-name"), title = header("x-track-title").slice(0, 60), licence = header("x-track-licence").slice(0, 160);
    const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
    if (!fileName || !req.body || !TYPES[ext]) throw new AppError("VALIDATION_FAILED", "Choose an MP3, M4A, AAC or WAV file.");
    if (!title || !licence) throw new AppError("VALIDATION_FAILED", "Give the track a title and say where its licence comes from.");
    const list = await getUploadedMusic();
    if (list.length >= MAX_TRACKS) throw new AppError("VALIDATION_FAILED", `The library holds up to ${MAX_TRACKS} uploaded tracks. Remove one first.`);
    const stored = await storeStream(Readable.fromWeb(req.body as unknown as NodeWebStream), {
      workspaceId: "platform", fileName, mimeType: TYPES[ext]!, maxBytes: 30 * MB, tooLarge: "Music tracks can be up to 30 MB.",
    });
    const track = { id: `up-${randomUUID().slice(0, 8)}`, title, licence, storageKey: stored.storageKey, uploadedBy: session.user.displayName, uploadedAt: new Date().toISOString() };
    await storeUploadedMusic([...list, track], session.user.id);
    await recordAudit(session, { action: "settings.changed", resourceType: "music", resourceId: track.id, resourceLabel: `Studio music added: ${title} (${licence})` });
    return NextResponse.json({ id: track.id });
  } catch (err) {
    if (!(err instanceof AppError)) console.error(`[music] correlation=${correlationId}`, err instanceof Error ? err.name : "unknown");
    const body = toApiError(err, correlationId);
    return NextResponse.json(body, { status: HTTP_STATUS[body.code] });
  }
}

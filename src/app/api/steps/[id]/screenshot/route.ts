import { NextResponse } from "next/server";
import { db } from "@/lib/database/client";
import { getSession, type Session } from "@/lib/auth/session";
import { readStoredFile, saveFile, storageKeyFor } from "@/lib/services/storage";
import { AppError, HTTP_STATUS, newCorrelationId, toApiError } from "@/lib/utilities/errors";
import { recordAudit } from "@/server/audit";

export const dynamic = "force-dynamic";
const MAX_BYTES = 5 * 1024 * 1024;
const PNG = [0x89, 0x50, 0x4e, 0x47];

async function stepFor(session: Session, id: string) {
  const step = await db.guideStep.findFirst({ where: { id, project: { workspaceId: session.workspace.id, deletedAt: null } }, include: { project: { select: { id: true, title: true, status: true, currentVersion: true } } } });
  if (!step) throw new AppError("PROJECT_NOT_FOUND", "That step could not be found.");
  return step;
}
const fail = (err: unknown) => { const body = toApiError(err, newCorrelationId()); return NextResponse.json(body, { status: HTTP_STATUS[body.code] }); };

/** The step's captured screenshot (PNG), for anyone who can view the project. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) throw new AppError("UNAUTHENTICATED", "Your session has ended. Sign in again to continue.");
    const step = await stepFor(session, (await ctx.params).id);
    if (!step.screenshotKey) throw new AppError("PROJECT_NOT_FOUND", "This step has no screenshot yet.");
    return new Response(new Uint8Array(await readStoredFile(step.screenshotKey)), { headers: { "content-type": "image/png", "cache-control": "private, max-age=60", "x-content-type-options": "nosniff" } });
  } catch (err) { return fail(err); }
}

/** Stores a frame captured in the browser from the project's own recording. PNG only, 5 MB max. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) throw new AppError("UNAUTHENTICATED", "Your session has ended. Sign in again to continue.");
    if (!session.permissions.has("guide.edit")) throw new AppError("PERMISSION_DENIED", "Your role can't change guide screenshots.");
    const step = await stepFor(session, (await ctx.params).id);
    if (["sme-review", "approval-pending", "compliance-review", "approved", "published"].includes(step.project.status)) throw new AppError("INVALID_STATE", "Screenshots can't change while this version is in review or approved.");
    const file = (await req.formData().catch(() => null))?.get("file");
    if (!(file instanceof File) || file.size === 0 || file.size > MAX_BYTES) throw new AppError("VALIDATION_FAILED", "Send one PNG image up to 5 MB.");
    const buf = Buffer.from(await file.arrayBuffer());
    if (!PNG.every((b, i) => buf[i] === b)) throw new AppError("VALIDATION_FAILED", "Only PNG images are accepted.");
    const key = storageKeyFor(session.workspace.id, `step-${step.id}.png`);
    await saveFile(key, buf, "image/png");
    await db.guideStep.update({ where: { id: step.id }, data: { screenshotKey: key, altText: `Screenshot of step ${step.order + 1}: ${step.title}` } });
    if (step.order === 0) await recordAudit(session, { action: "screenshots.captured", resourceType: "project", resourceId: step.project.id, resourceLabel: step.project.title, resourceVersion: step.project.currentVersion });
    return NextResponse.json({ ok: true });
  } catch (err) { return fail(err); }
}

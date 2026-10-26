"use server";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/database/client";
import { assertPermission, requireSession } from "@/lib/auth/session";
import { edlProblem, edlSchema, outputDuration } from "@/lib/studio/edl";
import { enforceRate } from "@/lib/utilities/rate-limit";
import { AppError } from "@/lib/utilities/errors";
import { recordAudit } from "@/server/audit";
import { findProject } from "@/server/queries";
import { runStudioRender } from "@/server/jobs/studio-render";
import { studioEnabled, studioSource } from "@/server/studio";
import { run, type ActionResult } from "./result";

const LOCKED = ["processing", "sme-review", "approval-pending", "compliance-review"];

async function editableProject(projectId: string) {
  const s = await requireSession();
  assertPermission(s, "project.edit");
  if (!(await studioEnabled())) throw new AppError("INVALID_STATE", "Studio isn't switched on in this environment.");
  const p = await findProject(s, projectId);
  if (!p) throw new AppError("PROJECT_NOT_FOUND", "The requested project could not be found.");
  if (LOCKED.includes(p.status)) throw new AppError("INVALID_STATE", "This project is processing or in review, so it can't be edited right now.");
  return { s, p };
}

/**
 * Saves the edit list. `revision` is the one the editor last loaded or saved: if someone else saved
 * since, the save is refused so nobody's edits are silently overwritten.
 */
export async function saveStudioEdit(input: { projectId: string; revision: number; edl: unknown }): Promise<ActionResult<{ revision: number }>> {
  return run(async () => {
    const { s, p } = await editableProject(z.string().cuid().parse(input.projectId));
    const edl = edlSchema.parse(input.edl);
    const row = await db.studioEdit.findUnique({ where: { projectId: p.id } });
    if (!row) throw new AppError("INVALID_STATE", "Open Studio again to start editing.");
    // The recording's real length comes from the server's copy, never from the browser.
    const stored = edlSchema.parse(JSON.parse(row.edl));
    const problem = edlProblem({ ...edl, sourceDuration: stored.sourceDuration }, stored.sourceDuration);
    if (problem) throw new AppError("VALIDATION_FAILED", problem);
    const { count } = await db.studioEdit.updateMany({
      where: { projectId: p.id, revision: input.revision },
      data: { edl: JSON.stringify({ ...edl, sourceDuration: stored.sourceDuration }), revision: { increment: 1 }, updatedById: s.user.id },
    });
    if (!count) throw new AppError("VERSION_CONFLICT", "Someone else saved this edit in the meantime. Reload Studio to see their changes.");
    return { revision: input.revision + 1 };
  });
}

/** Renders the edit list to an MP4 in the background. One render at a time per project. */
export async function startStudioRender(input: { projectId: string; captions: boolean }): Promise<ActionResult<{ renderId: string }>> {
  return run(async () => {
    const { s, p } = await editableProject(z.string().cuid().parse(input.projectId));
    enforceRate("render", s.user.id);
    if (!(await studioSource(p.id))) throw new AppError("INVALID_STATE", "Studio renders recordings and videos only.");
    const row = await db.studioEdit.findUnique({ where: { projectId: p.id } });
    if (!row) throw new AppError("INVALID_STATE", "Open Studio again to start editing.");
    const busy = await db.renderJob.findFirst({ where: { projectId: p.id, status: { in: ["queued", "running"] } } });
    if (busy) throw new AppError("INVALID_STATE", "A render is already running for this project.");
    const edl = edlSchema.parse(JSON.parse(row.edl));
    const job = await db.renderJob.create({ data: { projectId: p.id, version: p.currentVersion, status: "queued", language: p.primaryLanguage, engine: "studio", aiVoice: false, captions: input.captions, createdById: s.user.id } });
    await recordAudit(s, { action: "video.rendered", resourceType: "project", resourceId: p.id, resourceLabel: `${p.title} · Studio render started (${edl.clips.length} clips, ${edl.blurs.length} blurs, ${Math.round(outputDuration(edl))} s)`, resourceVersion: p.currentVersion });
    after(() => runStudioRender(job.id));
    revalidatePath(`/projects/${p.id}/studio`);
    return { renderId: job.id };
  });
}

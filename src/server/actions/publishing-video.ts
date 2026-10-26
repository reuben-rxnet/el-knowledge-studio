"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/database/client";
import { assertPermission, requireSession } from "@/lib/auth/session";
import { AppError } from "@/lib/utilities/errors";
import { recordAudit } from "@/server/audit";
import { findProject } from "@/server/queries";
import { run, type ActionResult } from "./result";

const schema = z.object({ projectId: z.string().cuid(), renderId: z.string().cuid(), use: z.boolean().default(true) });

/**
 * Chooses which rendered video (Video tab or Studio) is published with a version, or clears the choice.
 * Either side may choose: the creator (project.edit) while finishing the video, or the publisher
 * (publish.execute) at release time; the choice is audited either way. The render must have
 * succeeded and be of the approved version or of the version being edited; the choice is stored on
 * that version, so a v+1 render never replaces the video of the approved v.
 */
export async function setOfficialRender(input: z.input<typeof schema>): Promise<ActionResult<{ version: number; renderId: string | null }>> {
  return run(async () => {
    const s = await requireSession();
    if (!s.permissions.has("publish.execute")) assertPermission(s, "project.edit");
    const v = schema.parse(input);
    const p = await findProject(s, v.projectId);
    if (!p) throw new AppError("PROJECT_NOT_FOUND", "The requested project could not be found.");
    const r = await db.renderJob.findFirst({ where: { id: v.renderId, projectId: p.id } });
    if (!r) throw new AppError("PROJECT_NOT_FOUND", "That rendered video isn't part of this project.");
    if (r.status !== "succeeded" || !r.outputKey) throw new AppError("INVALID_STATE", "Only a finished render can be chosen for publishing.");
    if (r.version !== p.approvedVersion && r.version !== p.currentVersion) {
      throw new AppError("INVALID_STATE", `This video was rendered from version ${r.version}, which is no longer approved or being edited. Render version ${p.currentVersion} instead.`);
    }
    const row = await db.projectVersion.findUnique({ where: { projectId_number: { projectId: p.id, number: r.version } } });
    if (!row) throw new AppError("INVALID_STATE", `Version ${r.version} has no history entry, so a video can't be chosen for it.`);
    const next = v.use ? r.id : row.officialRenderId === r.id ? null : row.officialRenderId;
    if (next !== row.officialRenderId) {
      await db.projectVersion.update({ where: { id: row.id }, data: { officialRenderId: next } });
      const what = `${r.engine === "studio" ? "Studio" : "Video tab"} render${r.durationSec ? `, ${r.durationSec} s` : ""}`;
      await recordAudit(s, { action: "video.chosen", resourceType: "project", resourceId: p.id, resourceLabel: `${p.title} · ${next ? `video for publishing: ${what}` : "video for publishing cleared"}`, resourceVersion: r.version });
    }
    revalidatePath(`/projects/${p.id}`, "layout");
    return { version: r.version, renderId: next };
  });
}

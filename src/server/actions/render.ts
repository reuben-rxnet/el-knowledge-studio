"use server";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/database/client";
import { assertPermission, requireSession } from "@/lib/auth/session";
import { TTS_LANGUAGES, TTS_VOICES } from "@/lib/services/local/speech";
import { AppError } from "@/lib/utilities/errors";
import { recordAudit } from "@/server/audit";
import { findProject } from "@/server/queries";
import { runRender } from "@/server/jobs/render";
import { run, type ActionResult } from "./result";

const schema = z.object({
  projectId: z.string().cuid(),
  language: z.string().min(2).max(8),
  aiVoice: z.boolean(),
  voice: z.enum(TTS_VOICES.map((v) => v.id) as [string, ...string[]]).optional(),
});

/** Starts an MP4 render of the current version in the background. One render at a time per project. */
export async function startRender(input: z.input<typeof schema>): Promise<ActionResult<{ renderId: string }>> {
  return run(async () => {
    const s = await requireSession();
    assertPermission(s, "project.edit");
    const v = schema.parse(input);
    const p = await findProject(s, v.projectId);
    if (!p) throw new AppError("PROJECT_NOT_FOUND", "The requested project could not be found.");
    if (p.status === "processing") throw new AppError("INVALID_STATE", "Wait for processing to finish before rendering.");
    if (v.aiVoice && !TTS_LANGUAGES.includes(v.language)) throw new AppError("VALIDATION_FAILED", "The AI voice is available in English only. Render without it, or choose English.");
    if (v.language !== p.primaryLanguage && !(await db.translationSegment.count({ where: { projectId: p.id, language: v.language, sourceType: "script" } }))) {
      throw new AppError("VALIDATION_FAILED", "There's no translated script in that language yet.");
    }
    const busy = await db.renderJob.findFirst({ where: { projectId: p.id, status: { in: ["queued", "running"] } } });
    if (busy) throw new AppError("INVALID_STATE", "A render is already running for this project.");
    const job = await db.renderJob.create({ data: { projectId: p.id, version: p.currentVersion, status: "queued", language: v.language, aiVoice: v.aiVoice, voice: v.aiVoice ? v.voice ?? "bf_emma" : null, createdById: s.user.id } });
    await recordAudit(s, { action: "video.rendered", resourceType: "project", resourceId: p.id, resourceLabel: `${p.title} · render started (${v.language}${v.aiVoice ? ", AI voice" : ""})`, resourceVersion: p.currentVersion });
    after(() => runRender(job.id));
    revalidatePath(`/projects/${p.id}/video`);
    return { renderId: job.id };
  });
}

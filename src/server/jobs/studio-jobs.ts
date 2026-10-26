import "server-only";
import { db } from "@/lib/database/client";
import { detectActivity, zoomsFromEvents } from "@/lib/services/local/activity";
import { probeMedia } from "@/lib/services/local/ffmpeg";
import { detectScreenPii } from "@/lib/services/local/pii";
import { transcribeWords } from "@/lib/services/local/speech";
import { openAIScreenPii } from "@/lib/services/openai/services";
import { aiProviderId, assertExternalAiAllowed } from "@/lib/services/registry";
import { withLocalFile } from "@/lib/services/storage";
import { edlSchema, replaceAutoBlurs, replaceAutoZooms, type Edl } from "@/lib/studio/edl";
import { piiCodexEnabled } from "@/server/settings";
import { saveStudioWords, studioSource } from "@/server/studio";

const progress = (id: string, detail: string) => db.studioJob.update({ where: { id }, data: { detail } });

/**
 * Runs one Studio background job:
 *   words  word timings for text editing (Whisper on this server), kept with the video Studio edits
 *   pii    personal data on screen: replaces the edit's automatic blur boxes (hand-drawn ones stay)
 *   zoom   automatic zooms where the screen changes: replaces the found zooms (hand-made ones stay)
 */
export async function runStudioJob(jobId: string) {
  const claim = await db.studioJob.updateMany({ where: { id: jobId, status: "queued" }, data: { status: "running", detail: "Starting" } });
  if (!claim.count) return;
  const job = await db.studioJob.findUniqueOrThrow({ where: { id: jobId } });
  try {
    const project = await db.project.findUniqueOrThrow({ where: { id: job.projectId } });
    const source = await studioSource(project.id);
    if (!source) throw new Error("This project has no video for Studio.");

    if (job.kind === "words") {
      await progress(job.id, "Listening to the recording (the first run loads the speech model)");
      const words = await withLocalFile(source.storageKey, (f) => transcribeWords(f, project.primaryLanguage));
      await saveStudioWords(source, JSON.stringify(words));
      await finish(job.id, words.length ? `${words.length.toLocaleString()} words ready for editing` : "No speech was found in the recording");
      return;
    }

    if (job.kind === "zoom") {
      const found = await withLocalFile(source.storageKey, async (f) => {
        const info = await probeMedia(f);
        const events = await detectActivity(f, async (sec) => { await progress(job.id, `Watching for clicks: ${Math.round(sec)} of ${Math.round(info.durationSec)} s`); });
        return zoomsFromEvents(events, info.durationSec);
      });
      await updateEdl(project.id, job.createdById, (e) => replaceAutoZooms(e, found.map((z, i) => ({ ...z, id: `zauto${i + 1}`, auto: true }))));
      await finish(job.id, found.length ? `Added ${found.length} zoom${found.length === 1 ? "" : "s"} where the screen changed. Check each one before rendering.` : "No clicks or changes worth zooming into were found.");
      return;
    }

    // pii: names from the app's directory (people in this workspace), plus Codex only if switched on.
    const members = await db.workspaceMembership.findMany({ where: { workspaceId: project.workspaceId }, include: { user: { select: { displayName: true } } } });
    const names = members.map((m) => m.user.displayName).filter((n) => n.trim().split(/\s+/).length >= 2);
    let classify: ((lines: string[]) => Promise<{ line: number; parts: string[] }[]>) | undefined;
    let note = "";
    if (await piiCodexEnabled()) {
      if (aiProviderId() !== "openai") note = " Codex check is on, but the AI provider is simulated here.";
      else {
        try { assertExternalAiAllowed(project.classification); classify = (lines) => openAIScreenPii(lines); }
        catch { note = ` Codex check skipped: ${project.classification} content can't be sent to an external model.`; }
      }
    }
    const found = await withLocalFile(source.storageKey, async (f) => {
      const info = await probeMedia(f);
      if (!info.width || !info.height) throw new Error("The recording's picture size couldn't be read.");
      return detectScreenPii(f, { durationSec: info.durationSec, width: info.width, height: info.height, names, classify, onProgress: async (d, t) => { if (d % 5 === 0 || d === t) await progress(job.id, `Reading the screen: ${d} of ${t} frames`); } });
    });
    await updateEdl(project.id, job.createdById, (e) => replaceAutoBlurs(e, found.map((b, i) => ({ ...b, id: `auto${i + 1}`, auto: true }))));
    const NOUN: Record<string, [string, string]> = { "Email address": ["email address", "email addresses"], "Phone number": ["phone number", "phone numbers"], Name: ["name", "names"], "Personal data": ["other item of personal data", "other items of personal data"] };
    const counts = Object.entries(found.reduce<Record<string, number>>((m, b) => ({ ...m, [b.label]: (m[b.label] ?? 0) + 1 }), {}))
      .map(([k, v]) => `${v} ${(NOUN[k] ?? [k.toLowerCase(), `${k.toLowerCase()}s`])[v === 1 ? 0 : 1]}`);
    await finish(job.id, (found.length ? `Blurred ${counts.join(", ")}. Check each one before rendering.` : "No personal data found on screen.") + note);
  } catch (e) {
    await db.studioJob.update({ where: { id: job.id }, data: { status: "failed", detail: e instanceof Error ? e.message.slice(0, 300) : "The job failed.", completedAt: new Date() } });
  }
}

/** Applies a change to the saved edit list as one new revision (editing pauses while a job writes it). */
async function updateEdl(projectId: string, userId: string, change: (e: Edl) => Edl) {
  const row = await db.studioEdit.findUnique({ where: { projectId } });
  if (!row) throw new Error("Open Studio again to start editing.");
  const edl = change(edlSchema.parse(JSON.parse(row.edl)));
  await db.studioEdit.update({ where: { projectId }, data: { edl: JSON.stringify(edl), revision: { increment: 1 }, updatedById: userId } });
}

const finish = (id: string, detail: string) => db.studioJob.update({ where: { id }, data: { status: "succeeded", detail, completedAt: new Date() } });

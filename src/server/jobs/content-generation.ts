import "server-only";
import { db } from "@/lib/database/client";
import { csv } from "@/lib/domain/constants";
import { generatedContentSchema } from "@/lib/services/interfaces";
import { snapshotJob } from "@/lib/services/processing-plan";
import { services } from "@/lib/services/registry";

/**
 * Advances a ContentGenerationJob. Safe to call from any number of pollers:
 * progress is derived from time, and the generated-content write is claimed with a
 * conditional update (materialized=false → true) so it runs exactly once.
 */
export async function advanceJob(jobId: string) {
  const job = await db.processingJob.findUnique({ where: { id: jobId }, include: { project: true } });
  if (!job) return null;
  const snap = snapshotJob(job);
  if (snap.status !== "succeeded" || job.materialized) return { job, snapshot: snap };

  const claim = await db.processingJob.updateMany({ where: { id: job.id, materialized: false }, data: { materialized: true } });
  if (claim.count === 0) return { job, snapshot: snap };

  const p = job.project;
  try {
    const raw = await services.guide().generate({
      title: p.title, description: p.description, businessFunction: p.businessFunction, sourceSystem: p.sourceSystem,
      audience: p.audience, primaryLanguage: p.primaryLanguage, durationSec: p.durationSec || 240,
      protectedTerms: [p.sourceSystem, "EssilorLuxottica"].filter(Boolean),
    });
    // AI output is never stored unless it validates.
    const content = generatedContentSchema.parse(raw);
    const dur = Math.max(p.durationSec, (content.steps.at(-1)?.sourceSec ?? 0) + 30);
    const ordered = [...content.steps].sort((a, b) => a.sourceSec - b.sourceSec);

    await db.$transaction(async (tx) => {
      for (const [i, s] of ordered.entries()) {
        const end = ordered[i + 1]?.sourceSec ?? dur;
        const chapter = content.chapters[s.chapterIndex]?.title ?? content.chapters[0]!.title;
        const redact = content.sensitiveRegions.some((r) => r.stepIndex === i);
        await tx.scene.create({ data: { projectId: p.id, order: i, title: s.title, summary: s.instruction.slice(0, 120), startSec: s.sourceSec, endSec: end, focusZoom: i % 2 === 0, redaction: redact } });
        await tx.scriptSegment.create({ data: { projectId: p.id, order: i, startSec: s.sourceSec, endSec: end, originalText: s.transcript, text: s.instruction, origin: "ai", flagged: s.uncertainTerm ?? null } });
        await tx.guideStep.create({ data: { projectId: p.id, order: i, chapter, title: s.title, instruction: s.instruction, expectedResult: s.expectedResult ?? null, warning: s.warning ?? null, tip: s.tip ?? null, altText: `Screenshot: ${s.title.toLowerCase()}`, sourceSec: s.sourceSec, origin: "ai", markerX: 30 + ((i * 17) % 45), markerY: 30 + ((i * 23) % 40) } });
      }
      for (const f of content.faqs) await tx.faqItem.create({ data: { projectId: p.id, question: f.question, answer: f.answer, origin: "ai" } });
      for (const lang of csv(p.targetLanguages)) {
        await tx.translationProject.upsert({ where: { projectId_language: { projectId: p.id, language: lang } }, update: {}, create: { projectId: p.id, language: lang, status: "machine", reviewerName: "Unassigned", completion: 35, videoStatus: "Not started", guideStatus: "Machine draft", captionStatus: "Machine draft", voiceStatus: "Not started" } });
      }
      await tx.project.update({ where: { id: p.id }, data: { status: "ai-generated", durationSec: dur } });
      await tx.processingJob.update({ where: { id: job.id }, data: { status: "succeeded", completedAt: new Date() } });
      await tx.notification.create({ data: { userId: p.ownerId, kind: "processing.completed", title: "Your draft is ready", body: `${p.title}: video, guide and article drafts are ready to review.`, href: `/projects/${p.id}/video`, createdAt: new Date() } });
      await tx.auditEvent.create({ data: { actorId: p.ownerId, actorName: "EL Knowledge Studio (system)", action: "ai.generation.completed", resourceType: "project", resourceId: p.id, resourceLabel: p.title, resourceVersion: p.currentVersion, workspaceId: p.workspaceId, outcome: "success", correlationId: job.correlationId } });
    });
  } catch (err) {
    // Validation or provider failure: do not save as complete; mark for manual attention.
    const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "GENERATION_FAILED";
    await db.$transaction([
      db.processingJob.update({ where: { id: job.id }, data: { status: "failed", completedAt: new Date() } }),
      db.project.update({ where: { id: p.id }, data: { status: "draft" } }),
      db.auditEvent.create({ data: { actorId: p.ownerId, actorName: "EL Knowledge Studio (system)", action: "ai.generation.completed", resourceType: "project", resourceId: p.id, resourceLabel: p.title, resourceVersion: p.currentVersion, workspaceId: p.workspaceId, outcome: "failure", correlationId: job.correlationId, justification: code.slice(0, 64) } }),
      db.notification.create({ data: { userId: p.ownerId, kind: "processing.failed", title: "Processing failed", body: `${p.title}: the AI draft couldn't be created (${code.slice(0, 40)}). Your source is kept. Retry from the project.`, href: `/projects/${p.id}/processing` } }),
    ]);
  }
  const fresh = await db.processingJob.findUniqueOrThrow({ where: { id: job.id }, include: { project: true } });
  return { job: fresh, snapshot: snapshotJob(fresh) };
}

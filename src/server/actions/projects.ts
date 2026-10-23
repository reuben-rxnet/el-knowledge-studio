"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { keyBelongsTo, storedFileExists } from "@/lib/services/storage";
import { runLiveJob } from "@/server/jobs/pipeline";
import { db } from "@/lib/database/client";
import { assertPermission, requireSession } from "@/lib/auth/session";
import { CLASSIFICATION_POLICY, type Classification } from "@/lib/domain/constants";
import { assertExternalAiAllowed, services } from "@/lib/services/registry";
import { createProjectSchema, type CreateProjectInput } from "@/lib/validation/schemas";
import { enforceRate } from "@/lib/utilities/rate-limit";
import { AppError } from "@/lib/utilities/errors";
import { recordAudit } from "@/server/audit";
import { findProject } from "@/server/queries";
import { run, type ActionResult } from "./result";

export async function createProject(input: CreateProjectInput): Promise<ActionResult<{ projectId: string }>> {
  return run(async () => {
    const s = await requireSession();
    assertPermission(s, "project.create");
    const v = createProjectSchema.parse(input);
    enforceRate("generate", s.user.id);
    const policy = CLASSIFICATION_POLICY[v.classification as Classification];
    if (v.sourceKind === "recording" && !policy.recording) throw new AppError("CLASSIFICATION_BLOCKED", `${v.classification} content can't be recorded.`);
    assertExternalAiAllowed(v.classification);
    const blockedDest = v.destinations.filter((d) => !policy.destinations.includes(d));
    if (blockedDest.length) throw new AppError("CLASSIFICATION_BLOCKED", `${v.classification} content can't be published to ${blockedDest.join(", ")}.`);

    const correlationId = randomUUID();
    const project = await db.$transaction(async (tx) => {
      const p = await tx.project.create({
        data: {
          workspaceId: s.workspace.id, title: v.title, description: v.description, businessFunction: v.businessFunction, processCategory: v.processCategory,
          region: v.region, country: v.country, sourceSystem: v.sourceSystem, audience: v.audience, classification: v.classification,
          primaryLanguage: v.primaryLanguage, targetLanguages: v.targetLanguages.join(","), destinations: v.destinations.join(","), outputs: v.outputs.join(","),
          templateKey: v.templateKey, sourceKind: v.sourceKind, status: "processing", ownerId: s.user.id, smeName: v.smeName || null, approverName: v.approverName || null,
          reviewFrequencyDays: v.reviewFrequencyDays, nextReviewAt: new Date(Date.now() + v.reviewFrequencyDays * 86_400_000),
          durationSec: v.upload?.durationSec ?? 0, hue: 180 + Math.floor(Math.random() * 80), createdById: s.user.id, updatedById: s.user.id,
        },
      });
      await tx.projectVersion.create({ data: { projectId: p.id, number: 1, status: "draft", note: "Created from source", createdById: s.user.id } });
      const upload = v.upload ?? { fileName: `${v.title.slice(0, 40)}-notes.txt`, mimeType: "text/plain", sizeBytes: 0, checksum: randomUUID().replace(/-/g, ""), storageKey: undefined };
      // A stored file must belong to this workspace (keys are workspace-prefixed) and exist.
      let storageKey: string;
      let storedBytes = false;
      if (upload.storageKey) {
        if (!keyBelongsTo(upload.storageKey, s.workspace.id) || !(await storedFileExists(upload.storageKey))) throw new AppError("VALIDATION_FAILED", "The uploaded file couldn't be found. Upload it again.");
        storageKey = upload.storageKey;
        storedBytes = true;
      } else {
        storageKey = (await services.storage.putMetadata({ workspaceId: s.workspace.id, region: s.workspace.region, fileName: upload.fileName })).storageKey;
      }
      const scan = await services.scanner.scan(storageKey);
      if (scan === "blocked") throw new AppError("VALIDATION_FAILED", "The security scan blocked this file. It was not stored.");
      await tx.sourceAsset.create({ data: { projectId: p.id, kind: v.sourceKind, fileName: upload.fileName, mimeType: upload.mimeType, sizeBytes: upload.sizeBytes, durationSec: upload.durationSec ?? null, checksum: upload.checksum, scanStatus: scan, storageKey, storedBytes, createdById: s.user.id } });
      const job = await tx.processingJob.create({ data: { projectId: p.id, status: "queued", mode: "live", correlationId, startedAt: new Date() } });
      return { ...p, jobId: job.id };
    });

    for (const action of ["project.created", "source.uploaded", "ai.generation.started"] as const) {
      await recordAudit(s, { action, resourceType: "project", resourceId: project.id, resourceLabel: project.title, resourceVersion: 1, correlationId });
    }
    // Run the pipeline after the response is sent; the processing page polls its progress.
    after(() => runLiveJob(project.jobId));
    revalidatePath("/");
    return { projectId: project.id };
  });
}

/** Duplicate detection: same checksum already uploaded in this workspace. */
export async function checkDuplicate(checksum: string): Promise<ActionResult<{ duplicateOf: { id: string; title: string } | null }>> {
  return run(async () => {
    const s = await requireSession();
    const dup = await db.sourceAsset.findFirst({ where: { checksum, project: { workspaceId: s.workspace.id, deletedAt: null } }, include: { project: { select: { id: true, title: true } } } });
    return { duplicateOf: dup ? dup.project : null };
  });
}

export async function cancelJob(projectId: string): Promise<ActionResult> {
  return run(async () => {
    const s = await requireSession();
    assertPermission(s, "project.edit");
    const p = await findProject(s, projectId);
    if (!p) throw new AppError("PROJECT_NOT_FOUND", "The requested project could not be found.");
    // The runner checks for cancellation between stages and stops without writing further results.
    const res = await db.processingJob.updateMany({ where: { projectId, status: { in: ["queued", "running"] }, materialized: false }, data: { status: "cancelled", completedAt: new Date(), leaseUntil: null } });
    if (res.count) await db.project.update({ where: { id: projectId }, data: { status: "draft" } });
    await recordAudit(s, { action: "ai.generation.completed", resourceType: "project", resourceId: p.id, resourceLabel: p.title, resourceVersion: p.currentVersion, outcome: "failure", justification: "Cancelled by user" });
    revalidatePath(`/projects/${projectId}`);
    return undefined;
  });
}

export async function retryJob(projectId: string): Promise<ActionResult> {
  return run(async () => {
    const s = await requireSession();
    assertPermission(s, "project.edit");
    const p = await findProject(s, projectId);
    if (!p) throw new AppError("PROJECT_NOT_FOUND", "The requested project could not be found.");
    assertExternalAiAllowed(p.classification);
    const last = await db.processingJob.findFirst({ where: { projectId }, orderBy: { createdAt: "desc" } });
    if (last && ["running", "queued"].includes(last.status)) throw new AppError("INVALID_STATE", "This project is already processing.");
    // Never regenerate over content that is in review, approved or published.
    if (!["draft", "ai-generated", "creator-review", "changes-requested"].includes(p.status)) throw new AppError("INVALID_STATE", "This version is in review, approved or published. Regenerating would replace reviewed content.");
    enforceRate("generate", s.user.id);
    const [job] = await db.$transaction([
      db.processingJob.create({ data: { projectId, status: "queued", mode: "live", correlationId: randomUUID(), startedAt: new Date(), attempt: (last?.attempt ?? 0) + 1 } }),
      db.project.update({ where: { id: projectId }, data: { status: "processing" } }),
    ]);
    await recordAudit(s, { action: "ai.generation.started", resourceType: "project", resourceId: p.id, resourceLabel: p.title, resourceVersion: p.currentVersion });
    after(() => runLiveJob(job.id));
    revalidatePath(`/projects/${projectId}`);
    return undefined;
  });
}

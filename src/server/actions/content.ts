"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/database/client";
import { assertPermission, requireSession, type Session } from "@/lib/auth/session";
import type { Permission } from "@/lib/permissions";
import { assertExternalAiAllowed, services } from "@/lib/services/registry";
import { scriptEditSchema, stepEditSchema } from "@/lib/validation/schemas";
import { enforceRate } from "@/lib/utilities/rate-limit";
import { AppError } from "@/lib/utilities/errors";
import { recordAudit } from "@/server/audit";
import { findProject } from "@/server/queries";
import { run, type ActionResult } from "./result";

type EditOutcome = { version: number; newVersion: boolean };

/**
 * Guards every content edit: permission, workspace isolation, optimistic concurrency on the
 * project version, and version safety — editing an approved/published version creates a new
 * draft version; the approved version stays approved.
 */
async function beginEdit(s: Session, projectId: string, expectedVersion: number, permission: Permission = "project.edit") {
  assertPermission(s, permission);
  const p = await findProject(s, projectId);
  if (!p) throw new AppError("PROJECT_NOT_FOUND", "The requested project could not be found.");
  if (p.status === "processing") throw new AppError("INVALID_STATE", "This project is still processing. Edit it when the draft is ready.");
  if (p.currentVersion !== expectedVersion) throw new AppError("VERSION_CONFLICT", `Someone saved version ${p.currentVersion} while you were editing version ${expectedVersion}. Reload to see their changes.`, { currentVersion: p.currentVersion });
  let newVersion = false;
  let version = p.currentVersion;
  if (["approved", "published", "approval-pending", "sme-review", "compliance-review"].includes(p.status)) {
    if (p.status === "approved" || p.status === "published") {
      version = p.currentVersion + 1;
      newVersion = true;
      await db.$transaction([
        db.project.update({ where: { id: p.id }, data: { currentVersion: version, status: "creator-review", updatedById: s.user.id } }),
        db.projectVersion.create({ data: { projectId: p.id, number: version, status: "draft", note: `Draft created from approved v${p.approvedVersion}`, createdById: s.user.id } }),
      ]);
      await recordAudit(s, { action: "version.created", resourceType: "project", resourceId: p.id, resourceLabel: p.title, resourceVersion: version });
    } else {
      throw new AppError("INVALID_STATE", "This version is in review. Ask the reviewer to request changes, or wait for the decision.");
    }
  }
  return { project: p, version, newVersion };
}

async function finishEdit(s: Session, p: { id: string; title: string }, version: number, label = "content.edited" as const) {
  await db.project.update({ where: { id: p.id }, data: { updatedById: s.user.id, updatedAt: new Date() } });
  await recordAudit(s, { action: label, resourceType: "project", resourceId: p.id, resourceLabel: p.title, resourceVersion: version });
  revalidatePath(`/projects/${p.id}`, "layout");
}

async function segmentProject(segmentId: string) {
  const seg = await db.scriptSegment.findUnique({ where: { id: segmentId } });
  if (!seg) throw new AppError("PROJECT_NOT_FOUND", "That script paragraph no longer exists.");
  return seg;
}

export async function updateScript(input: { segmentId: string; text: string; expectedVersion: number }): Promise<ActionResult<EditOutcome>> {
  return run(async () => {
    const s = await requireSession();
    const v = scriptEditSchema.parse(input);
    const seg = await segmentProject(v.segmentId);
    const { project, version, newVersion } = await beginEdit(s, seg.projectId, input.expectedVersion);
    if (seg.locked) throw new AppError("INVALID_STATE", "This paragraph is locked as approved text. Unlock it first.");
    await db.scriptSegment.update({ where: { id: seg.id }, data: { text: v.text, origin: "human" } });
    await finishEdit(s, project, version);
    return { version, newVersion };
  });
}

export async function rewriteScript(input: { segmentId: string; instruction: "shorten" | "expand" | "simplify" | "professional" | "instructional"; expectedVersion: number }): Promise<ActionResult<EditOutcome & { text: string }>> {
  return run(async () => {
    const s = await requireSession();
    const seg = await segmentProject(input.segmentId);
    enforceRate("ai", s.user.id);
    const { project, version, newVersion } = await beginEdit(s, seg.projectId, input.expectedVersion);
    // Never silently replace human-approved text.
    if (seg.locked) throw new AppError("INVALID_STATE", "This paragraph is locked as approved text. Unlock it before asking AI to rewrite it.");
    assertExternalAiAllowed(project.classification);
    const text = await services.script().rewrite(seg.text, input.instruction, [project.sourceSystem].filter(Boolean));
    await db.scriptSegment.update({ where: { id: seg.id }, data: { text, origin: "ai-edited" } });
    await finishEdit(s, project, version);
    return { version, newVersion, text };
  });
}

export async function toggleScriptLock(input: { segmentId: string; expectedVersion: number }): Promise<ActionResult<EditOutcome>> {
  return run(async () => {
    const s = await requireSession();
    const seg = await segmentProject(input.segmentId);
    const { project, version, newVersion } = await beginEdit(s, seg.projectId, input.expectedVersion);
    await db.scriptSegment.update({ where: { id: seg.id }, data: { locked: !seg.locked } });
    await finishEdit(s, project, version);
    return { version, newVersion };
  });
}

async function stepOf(stepId: string) {
  const st = await db.guideStep.findUnique({ where: { id: stepId } });
  if (!st) throw new AppError("PROJECT_NOT_FOUND", "That step no longer exists.");
  return st;
}

export async function updateStep(input: { stepId: string; title: string; instruction: string; warning?: string; tip?: string; expectedVersion: number }): Promise<ActionResult<EditOutcome>> {
  return run(async () => {
    const s = await requireSession();
    const v = stepEditSchema.parse(input);
    const st = await stepOf(v.stepId);
    const { project, version, newVersion } = await beginEdit(s, st.projectId, input.expectedVersion, "guide.edit");
    await db.guideStep.update({ where: { id: st.id }, data: { title: v.title, instruction: v.instruction, warning: v.warning || null, tip: v.tip || null, origin: "human" } });
    await finishEdit(s, project, version);
    return { version, newVersion };
  });
}

export async function addStep(input: { projectId: string; afterOrder: number; expectedVersion: number }): Promise<ActionResult<EditOutcome & { stepId: string }>> {
  return run(async () => {
    const s = await requireSession();
    const { project, version, newVersion } = await beginEdit(s, input.projectId, input.expectedVersion, "guide.edit");
    const prev = await db.guideStep.findFirst({ where: { projectId: project.id, order: input.afterOrder } });
    const created = await db.$transaction(async (tx) => {
      await tx.guideStep.updateMany({ where: { projectId: project.id, order: { gt: input.afterOrder } }, data: { order: { increment: 1 } } });
      return tx.guideStep.create({ data: { projectId: project.id, order: input.afterOrder + 1, chapter: prev?.chapter ?? "Procedure", title: "New step", instruction: "Describe what the person does and what they should see.", altText: "Screenshot for the new step", sourceSec: prev?.sourceSec ?? 0, origin: "human" } });
    });
    await finishEdit(s, project, version);
    return { version, newVersion, stepId: created.id };
  });
}

export async function deleteStep(input: { stepId: string; expectedVersion: number }): Promise<ActionResult<EditOutcome>> {
  return run(async () => {
    const s = await requireSession();
    const st = await stepOf(input.stepId);
    const { project, version, newVersion } = await beginEdit(s, st.projectId, input.expectedVersion, "guide.edit");
    const count = await db.guideStep.count({ where: { projectId: project.id } });
    if (count <= 1) throw new AppError("INVALID_STATE", "A guide needs at least one step.");
    await db.$transaction([
      db.guideStep.delete({ where: { id: st.id } }),
      db.guideStep.updateMany({ where: { projectId: project.id, order: { gt: st.order } }, data: { order: { decrement: 1 } } }),
    ]);
    await finishEdit(s, project, version);
    return { version, newVersion };
  });
}

export async function moveStep(input: { stepId: string; direction: -1 | 1; expectedVersion: number }): Promise<ActionResult<EditOutcome>> {
  return run(async () => {
    const s = await requireSession();
    const st = await stepOf(input.stepId);
    const { project, version, newVersion } = await beginEdit(s, st.projectId, input.expectedVersion, "guide.edit");
    const other = await db.guideStep.findFirst({ where: { projectId: project.id, order: st.order + input.direction } });
    if (other) {
      await db.$transaction([
        db.guideStep.update({ where: { id: st.id }, data: { order: -1 } }),
        db.guideStep.update({ where: { id: other.id }, data: { order: st.order } }),
        db.guideStep.update({ where: { id: st.id }, data: { order: other.order } }),
      ]);
    }
    await finishEdit(s, project, version);
    return { version, newVersion };
  });
}

export async function updateScene(input: { sceneId: string; title?: string; focusZoom?: boolean; redaction?: boolean; expectedVersion: number }): Promise<ActionResult<EditOutcome>> {
  return run(async () => {
    const s = await requireSession();
    const sc = await db.scene.findUnique({ where: { id: input.sceneId } });
    if (!sc) throw new AppError("PROJECT_NOT_FOUND", "That scene no longer exists.");
    const { project, version, newVersion } = await beginEdit(s, sc.projectId, input.expectedVersion);
    const title = input.title?.trim();
    if (input.title !== undefined && !title) throw new AppError("VALIDATION_FAILED", "A chapter needs a title.");
    await db.scene.update({ where: { id: sc.id }, data: { ...(title ? { title } : {}), ...(input.focusZoom !== undefined ? { focusZoom: input.focusZoom } : {}), ...(input.redaction !== undefined ? { redaction: input.redaction } : {}) } });
    if (input.redaction !== undefined) await recordAudit(s, { action: "content.edited", resourceType: "scene", resourceId: sc.id, resourceLabel: `${project.title} · redaction ${input.redaction ? "added" : "removed"}`, resourceVersion: version });
    await finishEdit(s, project, version);
    return { version, newVersion };
  });
}

"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/database/client";
import { assertPermission, requireSession, type Session } from "@/lib/auth/session";
import { BUSINESS_FUNCTIONS, CLASSIFICATION_POLICY, CLASSIFICATIONS, csv, type Classification } from "@/lib/domain/constants";
import { AppError } from "@/lib/utilities/errors";
import { recordAudit } from "@/server/audit";
import { findProject } from "@/server/queries";
import { run, type ActionResult } from "./result";

async function projectOf(s: Session, projectId: string) {
  const p = await findProject(s, projectId);
  if (!p) throw new AppError("PROJECT_NOT_FOUND", "The requested project could not be found.");
  return p;
}
const touch = (projectId: string) => revalidatePath(`/projects/${projectId}`, "layout");

// --- AI review flags ----------------------------------------------------------------------

/** A reviewer or the creator decides what to do with a flag. The note is required so the decision is explained. */
export async function decideReviewFlag(input: { flagId: string; decision: "resolved" | "dismissed"; note: string }): Promise<ActionResult> {
  return run(async () => {
    const s = await requireSession();
    if (!s.permissions.has("review.comment") && !s.permissions.has("project.edit")) assertPermission(s, "review.comment");
    const v = z.object({ flagId: z.string().cuid(), decision: z.enum(["resolved", "dismissed"]), note: z.string().trim().min(3, "Say what you did, or why the flag doesn't apply.").max(500) }).parse(input);
    const flag = await db.reviewFlag.findUnique({ where: { id: v.flagId } });
    if (!flag) throw new AppError("PROJECT_NOT_FOUND", "That flag no longer exists.");
    const p = await projectOf(s, flag.projectId);
    await db.$transaction([
      db.reviewFlag.update({ where: { id: flag.id }, data: { status: v.decision, decidedById: s.user.id, decidedAt: new Date() } }),
      db.comment.create({ data: { projectId: p.id, authorId: s.user.id, body: `${v.decision === "resolved" ? "Resolved" : "Dismissed"} AI flag (${flag.kind}) on “${flag.quote.slice(0, 120)}”: ${v.note}`, anchorType: flag.stepId ? "step" : "project", anchorRef: flag.stepId, anchorLabel: "AI review flag", version: p.currentVersion } }),
    ]);
    await recordAudit(s, { action: "review.flag.decided", resourceType: "project", resourceId: p.id, resourceLabel: `${p.title} · ${flag.kind} flag ${v.decision}`, resourceVersion: p.currentVersion, justification: v.note });
    touch(p.id);
    return undefined;
  });
}

// --- AI metadata suggestions --------------------------------------------------------------

const suggestionSchema = z.object({ title: z.string(), businessFunction: z.string(), audience: z.string(), classification: z.enum(CLASSIFICATIONS), classificationReason: z.string() });

export async function applySuggestion(input: { projectId: string; field: "title" | "businessFunction" | "audience" | "classification" }): Promise<ActionResult> {
  return run(async () => {
    const s = await requireSession();
    assertPermission(s, "project.edit");
    const p = await projectOf(s, input.projectId);
    if (["sme-review", "approval-pending", "compliance-review"].includes(p.status)) throw new AppError("INVALID_STATE", "This version is in review. Change details after the decision.");
    const sug = suggestionSchema.safeParse(JSON.parse(p.aiSuggestions ?? "null"));
    if (!sug.success) throw new AppError("INVALID_STATE", "There are no AI suggestions for this project.");
    const value = sug.data[input.field];
    if (input.field === "businessFunction" && !(BUSINESS_FUNCTIONS as readonly string[]).includes(value)) throw new AppError("VALIDATION_FAILED", "The suggested function isn't one of the allowed values.");
    if (input.field === "classification") {
      const policy = CLASSIFICATION_POLICY[value as Classification];
      const blocked = csv(p.destinations).filter((d) => !policy.destinations.includes(d));
      await db.project.update({ where: { id: p.id }, data: { classification: value, destinations: csv(p.destinations).filter((d) => !blocked.includes(d)).join(","), updatedById: s.user.id } });
      await recordAudit(s, { action: "classification.changed", resourceType: "project", resourceId: p.id, resourceLabel: `${p.title}: ${p.classification} → ${value}`, resourceVersion: p.currentVersion, justification: sug.data.classificationReason });
    } else {
      await db.project.update({ where: { id: p.id }, data: { [input.field]: value, updatedById: s.user.id } });
      await recordAudit(s, { action: "suggestion.applied", resourceType: "project", resourceId: p.id, resourceLabel: `${p.title} · ${input.field}`, resourceVersion: p.currentVersion });
    }
    touch(p.id);
    return undefined;
  });
}

// --- Quiz review --------------------------------------------------------------------------

const quizEdit = z.object({
  questionId: z.string().cuid(),
  question: z.string().trim().min(5).max(500),
  options: z.array(z.string().trim().min(1).max(300)).min(2).max(6),
  correct: z.array(z.number().int().nonnegative()).min(1),
  explanation: z.string().trim().min(3).max(800),
}).refine((v) => v.correct.every((i) => i < v.options.length), { path: ["correct"], message: "Mark at least one existing option as correct." });

async function questionOf(s: Session, id: string) {
  const q = await db.quizQuestion.findUnique({ where: { id } });
  if (!q) throw new AppError("PROJECT_NOT_FOUND", "That question no longer exists.");
  return { q, p: await projectOf(s, q.projectId) };
}

/** Editing a question sends it back to "needs review": the approver must see the final wording. */
export async function editQuizQuestion(input: z.input<typeof quizEdit>): Promise<ActionResult> {
  return run(async () => {
    const s = await requireSession();
    assertPermission(s, "project.edit");
    const v = quizEdit.parse(input);
    const { q, p } = await questionOf(s, v.questionId);
    await db.quizQuestion.update({ where: { id: q.id }, data: { question: v.question, options: JSON.stringify(v.options), correct: JSON.stringify(v.correct), explanation: v.explanation, reviewStatus: "needs-review" } });
    await recordAudit(s, { action: "quiz.edited", resourceType: "project", resourceId: p.id, resourceLabel: `${p.title} · quiz Q${q.order + 1}`, resourceVersion: p.currentVersion });
    touch(p.id);
    return undefined;
  });
}

export async function decideQuizQuestion(input: { questionId: string; decision: "approve" | "remove" }): Promise<ActionResult> {
  return run(async () => {
    const s = await requireSession();
    assertPermission(s, input.decision === "approve" ? "review.approve" : "project.edit");
    const { q, p } = await questionOf(s, input.questionId);
    if (input.decision === "remove") await db.quizQuestion.delete({ where: { id: q.id } });
    else await db.quizQuestion.update({ where: { id: q.id }, data: { reviewStatus: "approved" } });
    await recordAudit(s, { action: input.decision === "approve" ? "quiz.approved" : "quiz.edited", resourceType: "project", resourceId: p.id, resourceLabel: `${p.title} · quiz Q${q.order + 1} ${input.decision === "approve" ? "approved" : "removed"}`, resourceVersion: p.currentVersion });
    touch(p.id);
    return undefined;
  });
}

// --- Translator workflow ------------------------------------------------------------------

export async function editTranslationSegment(input: { segmentId: string; text: string }): Promise<ActionResult> {
  return run(async () => {
    const s = await requireSession();
    assertPermission(s, "translation.edit");
    const v = z.object({ segmentId: z.string().cuid(), text: z.string().trim().min(1, "A translation can't be empty.").max(4000) }).parse(input);
    const seg = await db.translationSegment.findUnique({ where: { id: v.segmentId } });
    if (!seg) throw new AppError("PROJECT_NOT_FOUND", "That translation no longer exists.");
    const p = await projectOf(s, seg.projectId);
    const tp = await db.translationProject.findUnique({ where: { projectId_language: { projectId: p.id, language: seg.language } } });
    if (tp?.status === "approved") throw new AppError("INVALID_STATE", "This language is approved. Reopen it to make changes.");
    await db.translationSegment.update({ where: { id: seg.id }, data: { text: v.text, status: "reviewed" } });
    await recordAudit(s, { action: "translation.edited", resourceType: "project", resourceId: p.id, resourceLabel: `${p.title} · ${seg.language}`, resourceVersion: p.currentVersion });
    touch(p.id);
    return undefined;
  });
}

export async function markSegmentsReviewed(input: { projectId: string; language: string }): Promise<ActionResult> {
  return run(async () => {
    const s = await requireSession();
    assertPermission(s, "translation.edit");
    const p = await projectOf(s, input.projectId);
    await db.translationSegment.updateMany({ where: { projectId: p.id, language: input.language }, data: { status: "reviewed" } });
    await recordAudit(s, { action: "translation.edited", resourceType: "project", resourceId: p.id, resourceLabel: `${p.title} · ${input.language} marked reviewed`, resourceVersion: p.currentVersion });
    touch(p.id);
    return undefined;
  });
}

/** Approve one language. Every segment must have been reviewed by a person first. */
export async function setTranslationApproval(input: { projectId: string; language: string; approve: boolean }): Promise<ActionResult> {
  return run(async () => {
    const s = await requireSession();
    assertPermission(s, "translation.edit");
    const p = await projectOf(s, input.projectId);
    const tp = await db.translationProject.findUnique({ where: { projectId_language: { projectId: p.id, language: input.language } } });
    if (!tp) throw new AppError("PROJECT_NOT_FOUND", "That language isn't part of this project.");
    if (input.approve) {
      const pending = await db.translationSegment.count({ where: { projectId: p.id, language: input.language, status: { not: "reviewed" } } });
      if (pending) throw new AppError("INVALID_STATE", `${pending} segment(s) are still machine translations. Review them, or use “Mark all reviewed” after checking.`);
    }
    await db.translationProject.update({ where: { id: tp.id }, data: input.approve ? { status: "approved", completion: 100, reviewerName: s.user.displayName, guideStatus: "Approved", captionStatus: "Approved" } : { status: "regional-review", completion: 90, guideStatus: "In review", captionStatus: "In review" } });
    await recordAudit(s, { action: input.approve ? "translation.approved" : "translation.edited", resourceType: "project", resourceId: p.id, resourceLabel: `${p.title} · ${input.language} ${input.approve ? "approved" : "reopened"}`, resourceVersion: p.currentVersion });
    touch(p.id);
    return undefined;
  });
}

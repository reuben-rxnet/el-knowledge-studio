"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/database/client";
import { assertPermission, requireSession } from "@/lib/auth/session";
import { CLASSIFICATION_POLICY, csv, destinationLabel, DESTINATIONS, type Classification } from "@/lib/domain/constants";
import { services } from "@/lib/services/registry";
import { commentSchema, decisionSchema, publishSchema } from "@/lib/validation/schemas";
import { AppError } from "@/lib/utilities/errors";
import { recordAudit } from "@/server/audit";
import { findProject } from "@/server/queries";
import { run, type ActionResult } from "./result";

const DAY = 86_400_000;

async function memberWithRole(workspaceId: string, roles: string[], preferredName?: string | null) {
  const members = await db.workspaceMembership.findMany({ where: { workspaceId }, include: { user: true } });
  const eligible = members.filter((m) => csv(m.roles).some((r) => roles.includes(r)));
  return eligible.find((m) => m.user.displayName === preferredName)?.user ?? eligible[0]?.user ?? null;
}

export async function submitForReview(input: { projectId: string; expectedVersion: number }): Promise<ActionResult> {
  return run(async () => {
    const s = await requireSession();
    assertPermission(s, "project.edit");
    const p = await findProject(s, input.projectId);
    if (!p) throw new AppError("PROJECT_NOT_FOUND", "The requested project could not be found.");
    if (p.currentVersion !== input.expectedVersion) throw new AppError("VERSION_CONFLICT", "This project changed since you opened it. Reload and try again.");
    if (!["ai-generated", "creator-review", "changes-requested", "draft"].includes(p.status)) throw new AppError("INVALID_STATE", "This version is already in review or approved.");
    const sme = await memberWithRole(s.workspace.id, ["sme", "reviewer"], p.smeName);
    if (!sme) throw new AppError("INVALID_STATE", "No subject-matter expert is available in this workspace. Ask an administrator to assign one.");
    await db.$transaction([
      db.reviewRequest.updateMany({ where: { projectId: p.id, status: "open" }, data: { status: "superseded" } }),
      db.reviewRequest.create({ data: { projectId: p.id, version: p.currentVersion, stage: "sme", status: "open", assigneeId: sme.id, requestedById: s.user.id, dueAt: new Date(Date.now() + 5 * DAY) } }),
      db.project.update({ where: { id: p.id }, data: { status: "sme-review", updatedById: s.user.id } }),
      db.notification.create({ data: { userId: sme.id, kind: "review.assigned", title: "Review assigned", body: `${p.title} v${p.currentVersion} is waiting for your SME review.`, href: `/projects/${p.id}/review` } }),
    ]);
    await recordAudit(s, { action: "review.submitted", resourceType: "project", resourceId: p.id, resourceLabel: p.title, resourceVersion: p.currentVersion });
    revalidatePath(`/projects/${p.id}`, "layout");
    return undefined;
  });
}

export async function addComment(input: { projectId: string; body: string; anchorType: "project" | "step" | "scene"; anchorRef?: string; anchorLabel?: string; timestampSec?: number }): Promise<ActionResult> {
  return run(async () => {
    const s = await requireSession();
    assertPermission(s, "review.comment");
    const v = commentSchema.parse(input);
    const p = await findProject(s, v.projectId);
    if (!p) throw new AppError("PROJECT_NOT_FOUND", "The requested project could not be found.");
    if (v.anchorRef) {
      const ok = v.anchorType === "step" ? await db.guideStep.count({ where: { id: v.anchorRef, projectId: p.id } }) : await db.scene.count({ where: { id: v.anchorRef, projectId: p.id } });
      if (!ok) throw new AppError("VALIDATION_FAILED", "That step or scene isn't part of this project.");
    }
    await db.comment.create({ data: { projectId: p.id, authorId: s.user.id, body: v.body, anchorType: v.anchorType, anchorRef: v.anchorRef ?? null, anchorLabel: input.anchorLabel?.slice(0, 60) ?? null, timestampSec: input.timestampSec ?? null, version: p.currentVersion } });
    // @mentions notify workspace members by first name.
    const mentions = [...v.body.matchAll(/@(\p{L}+)/gu)].map((m) => m[1]!.toLowerCase());
    if (mentions.length) {
      const members = await db.workspaceMembership.findMany({ where: { workspaceId: s.workspace.id }, include: { user: true } });
      for (const m of members.filter((x) => mentions.includes(x.user.displayName.split(" ")[0]!.toLowerCase()) && x.userId !== s.user.id)) {
        await db.notification.create({ data: { userId: m.userId, kind: "comment.mention", title: `${s.user.displayName} mentioned you`, body: `${p.title}: ${v.body.slice(0, 120)}`, href: `/projects/${p.id}/review` } });
      }
    }
    await recordAudit(s, { action: "comment.added", resourceType: "project", resourceId: p.id, resourceLabel: p.title, resourceVersion: p.currentVersion });
    revalidatePath(`/projects/${p.id}`, "layout");
    return undefined;
  });
}

export async function resolveComment(input: { commentId: string }): Promise<ActionResult> {
  return run(async () => {
    const s = await requireSession();
    assertPermission(s, "review.comment");
    const c = await db.comment.findUnique({ where: { id: input.commentId } });
    const p = c ? await findProject(s, c.projectId) : null;
    if (!c || !p) throw new AppError("PROJECT_NOT_FOUND", "That comment no longer exists.");
    await db.comment.update({ where: { id: c.id }, data: { resolvedAt: new Date() } });
    await recordAudit(s, { action: "comment.resolved", resourceType: "project", resourceId: p.id, resourceLabel: p.title, resourceVersion: c.version });
    revalidatePath(`/projects/${p.id}`, "layout");
    return undefined;
  });
}

/** Decisions apply to one exact version. The assignee (or a workspace admin) decides. */
export async function decideReview(input: { reviewId: string; expectedVersion: number; decision: "approve" | "request-changes"; justification?: string }): Promise<ActionResult<{ status: string }>> {
  return run(async () => {
    const s = await requireSession();
    assertPermission(s, "review.approve");
    const v = decisionSchema.parse({ ...input, justification: input.justification ?? "" });
    const r = await db.reviewRequest.findUnique({ where: { id: v.reviewId } });
    const p = r ? await findProject(s, r.projectId) : null;
    if (!r || !p) throw new AppError("PROJECT_NOT_FOUND", "That review request no longer exists.");
    if (r.status !== "open") throw new AppError("INVALID_STATE", "This review has already been decided.");
    const isAdmin = s.permissions.has("workspace.manage");
    if (r.assigneeId !== s.user.id && !isAdmin) throw new AppError("PERMISSION_DENIED", "Only the assigned reviewer can decide this review.");
    if (r.version !== p.currentVersion || r.version !== v.expectedVersion) throw new AppError("VERSION_CONFLICT", `This review is for version ${r.version}, but the project is now on version ${p.currentVersion}.`);

    if (v.decision === "approve") {
      const blocking = await db.reviewFlag.count({ where: { projectId: p.id, status: "open", kind: { in: ["risky", "contradiction"] } } });
      if (blocking) throw new AppError("INVALID_STATE", `${blocking} risky or contradictory statement(s) flagged by the AI are still open. Resolve or dismiss each one, with a note, before approving.`);
    }

    let status: string;
    if (v.decision === "request-changes") {
      status = "changes-requested";
      await db.$transaction([
        db.reviewRequest.update({ where: { id: r.id }, data: { status: "changes-requested", decidedAt: new Date(), justification: v.justification } }),
        db.project.update({ where: { id: p.id }, data: { status } }),
        db.comment.create({ data: { projectId: p.id, authorId: s.user.id, body: `Changes requested: ${v.justification}`, anchorType: "project", version: r.version } }),
        db.notification.create({ data: { userId: p.ownerId, kind: "review.changes", title: "Changes requested", body: `${s.user.displayName} requested changes to ${p.title} v${r.version}.`, href: `/projects/${p.id}/review` } }),
      ]);
      await recordAudit(s, { action: "approval.rejected", resourceType: "project", resourceId: p.id, resourceLabel: p.title, resourceVersion: r.version, justification: v.justification });
    } else if (r.stage === "sme") {
      status = "approval-pending";
      const approver = await memberWithRole(s.workspace.id, ["approver"], p.approverName);
      if (!approver) throw new AppError("INVALID_STATE", "No approver is available in this workspace. Ask an administrator to assign one.");
      await db.$transaction([
        db.reviewRequest.update({ where: { id: r.id }, data: { status: "approved", decidedAt: new Date() } }),
        db.reviewRequest.create({ data: { projectId: p.id, version: r.version, stage: "approval", status: "open", assigneeId: approver.id, requestedById: s.user.id, dueAt: new Date(Date.now() + 3 * DAY) } }),
        db.project.update({ where: { id: p.id }, data: { status } }),
        db.notification.create({ data: { userId: approver.id, kind: "review.assigned", title: "Approval requested", body: `${p.title} v${r.version} passed SME review and needs your approval.`, href: `/projects/${p.id}/review` } }),
      ]);
      await recordAudit(s, { action: "approval.granted", resourceType: "project", resourceId: p.id, resourceLabel: `${p.title} (SME review)`, resourceVersion: r.version });
    } else {
      status = "approved";
      await db.$transaction([
        db.reviewRequest.update({ where: { id: r.id }, data: { status: "approved", decidedAt: new Date() } }),
        db.project.update({ where: { id: p.id }, data: { status, approvedVersion: r.version, lastReviewedAt: new Date(), nextReviewAt: new Date(Date.now() + p.reviewFrequencyDays * DAY) } }),
        db.projectVersion.updateMany({ where: { projectId: p.id, number: r.version }, data: { status: "approved" } }),
        db.notification.create({ data: { userId: p.ownerId, kind: "approval.completed", title: "Approved", body: `${p.title} v${r.version} is approved and ready to publish.`, href: `/projects/${p.id}/publishing` } }),
      ]);
      await recordAudit(s, { action: "approval.granted", resourceType: "project", resourceId: p.id, resourceLabel: p.title, resourceVersion: r.version });
    }
    revalidatePath(`/projects/${p.id}`, "layout");
    return { status };
  });
}

export async function publishProject(input: { projectId: string; version: number; destinations: string[]; language: string; audience: string; requireAck?: boolean; watermark?: boolean }): Promise<ActionResult<{ results: { destination: string; message: string; simulated: boolean }[] }>> {
  return run(async () => {
    const s = await requireSession();
    assertPermission(s, "publish.execute");
    const v = publishSchema.parse(input);
    const p = await findProject(s, v.projectId);
    if (!p) throw new AppError("PROJECT_NOT_FOUND", "The requested project could not be found.");
    if (!p.approvedVersion || v.version !== p.approvedVersion) throw new AppError("INVALID_STATE", "Only the approved version can be published.");
    const policy = CLASSIFICATION_POLICY[p.classification as Classification];
    const blocked = v.destinations.filter((d) => !policy?.destinations.includes(d));
    if (blocked.length) throw new AppError("CLASSIFICATION_BLOCKED", `${p.classification} content can't be published to ${blocked.map(destinationLabel).join(", ")}.`);

    const results = [];
    for (const d of v.destinations) {
      const connector = services.connector(d);
      if (!connector) throw new AppError("INVALID_STATE", `${destinationLabel(d)} isn't connected in this environment.`);
      const target = DESTINATIONS.find((x) => x.key === d)!.target;
      const res = await connector.publish({ projectId: p.id, title: p.title, version: v.version, language: v.language, target, audience: v.audience });
      await db.publishingJob.create({ data: { projectId: p.id, version: v.version, destination: d, target, language: v.language, audience: v.audience, status: res.status, simulated: res.simulated, requireAck: v.requireAck, watermark: v.watermark, createdById: s.user.id } });
      await recordAudit(s, { action: "content.published", resourceType: "project", resourceId: p.id, resourceLabel: `${p.title} → ${destinationLabel(d)}${res.simulated ? " (simulated)" : ""}`, resourceVersion: v.version, outcome: res.status === "succeeded" ? "success" : "failure" });
      results.push({ destination: destinationLabel(d), message: res.message, simulated: res.simulated });
    }
    await db.project.update({ where: { id: p.id }, data: { status: p.currentVersion === v.version ? "published" : p.status, publishedVersion: v.version } });
    await db.projectVersion.updateMany({ where: { projectId: p.id, number: v.version }, data: { status: "published" } });
    revalidatePath(`/projects/${p.id}`, "layout");
    return { results };
  });
}

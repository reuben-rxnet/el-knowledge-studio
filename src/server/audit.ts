import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/database/client";
import { newCorrelationId } from "@/lib/utilities/errors";
import type { Session } from "@/lib/auth/session";

export type AuditAction =
  | "project.created"
  | "source.uploaded"
  | "recording.completed"
  | "ai.generation.started"
  | "ai.generation.completed"
  | "content.edited"
  | "version.created"
  | "classification.changed"
  | "review.submitted"
  | "comment.added"
  | "comment.resolved"
  | "approval.granted"
  | "approval.rejected"
  | "translation.approved"
  | "content.published"
  | "content.downloaded"
  | "permission.denied"
  | "search.feedback"
  | "ai.connection.tested"
  | "review.flag.decided"
  | "suggestion.applied"
  | "quiz.edited"
  | "quiz.approved"
  | "translation.edited"
  | "screenshots.captured"
  | "video.rendered";

interface AuditInput {
  action: AuditAction;
  resourceType: string;
  resourceId: string;
  /** A title or short label — never raw transcript, prompt or personal content. */
  resourceLabel: string;
  resourceVersion?: number;
  outcome?: "success" | "denied" | "failure";
  justification?: string;
  correlationId?: string;
}

type Tx = Prisma.TransactionClient | typeof db;

/** Append-only. There is intentionally no update or delete path for audit events. */
export async function recordAudit(session: Session, input: AuditInput, tx: Tx = db) {
  return tx.auditEvent.create({
    data: {
      actorId: session.user.id,
      actorName: session.user.displayName,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      resourceLabel: input.resourceLabel.slice(0, 160),
      resourceVersion: input.resourceVersion ?? null,
      workspaceId: session.workspace.id,
      outcome: input.outcome ?? "success",
      correlationId: input.correlationId ?? newCorrelationId(),
      justification: input.justification?.slice(0, 500) ?? null,
    },
  });
}

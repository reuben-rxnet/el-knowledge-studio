import "server-only";
import { notFound } from "next/navigation";
import { db } from "@/lib/database/client";
import type { Session } from "@/lib/auth/session";

/**
 * Workspace isolation: every project lookup is scoped to the session's active workspace.
 * A project in another workspace answers exactly like a missing one (no existence leak / IDOR).
 */
export async function findProject(session: Session, id: string) {
  return db.project.findFirst({ where: { id, workspaceId: session.workspace.id, deletedAt: null }, include: { owner: true } });
}

export async function getProjectOr404(session: Session, id: string) {
  const p = await findProject(session, id);
  if (!p) notFound();
  return p;
}

export async function listProjects(session: Session, opts: { status?: string; mine?: boolean; take?: number } = {}) {
  return db.project.findMany({
    where: {
      workspaceId: session.workspace.id,
      deletedAt: null,
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.mine ? { ownerId: session.user.id } : {}),
    },
    include: { owner: { select: { displayName: true } } },
    orderBy: { updatedAt: "desc" },
    take: opts.take ?? 50,
  });
}

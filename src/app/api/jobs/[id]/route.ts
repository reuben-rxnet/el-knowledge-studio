import { after, NextResponse } from "next/server";
import { db } from "@/lib/database/client";
import { getSession } from "@/lib/auth/session";
import { snapshotLiveJob } from "@/lib/services/processing-plan";
import { AppError, HTTP_STATUS, newCorrelationId, toApiError } from "@/lib/utilities/errors";
import { advanceJob } from "@/server/jobs/content-generation";
import { runLiveJob } from "@/server/jobs/pipeline";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const session = await getSession();
    if (!session) throw new AppError("UNAUTHENTICATED", "Your session has ended. Sign in again to continue.");
    const { id } = await ctx.params;
    // Workspace isolation: the job must belong to a project in the active workspace.
    const job = await db.processingJob.findFirst({ where: { id, project: { workspaceId: session.workspace.id } }, include: { project: { select: { status: true } } } });
    if (!job) throw new AppError("PROJECT_NOT_FOUND", "The requested processing job could not be found.");
    const technical = session.permissions.has("workspace.manage") ? { technical: { correlationId: job.correlationId, attempt: job.attempt, kind: job.kind, errorCode: job.errorCode } } : {};

    if (job.mode === "live") {
      // Resume a job whose runner stopped (server restart) once its lease has expired.
      if (["queued", "running"].includes(job.status) && (!job.leaseUntil || job.leaseUntil < new Date())) after(() => runLiveJob(job.id));
      return NextResponse.json({ jobId: job.id, projectId: job.projectId, projectStatus: job.project.status, ...snapshotLiveJob(job), ...technical }, { headers: { "cache-control": "no-store" } });
    }
    // Legacy timer-based jobs created before the live pipeline.
    const result = await advanceJob(job.id);
    if (!result) throw new AppError("PROJECT_NOT_FOUND", "The requested processing job could not be found.");
    return NextResponse.json({ jobId: result.job.id, projectId: result.job.projectId, projectStatus: result.job.project.status, ...result.snapshot, ...technical }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const body = toApiError(err, correlationId);
    return NextResponse.json(body, { status: HTTP_STATUS[body.code] });
  }
}

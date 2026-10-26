import { Clock3 } from "lucide-react";
import { requirePageSession } from "@/lib/auth/session";
import { db } from "@/lib/database/client";
import { relativeTime } from "@/lib/utilities/format";
import { getProjectOr404 } from "@/server/queries";
import { TonePill } from "@/components/common/badges";
import { EmptyState } from "@/components/common/empty-state";

/** Human-readable message templates for audit actions (externalised for localisation). */
const ACTIVITY_TEMPLATES: Record<string, (actor: string, v: number | null) => string> = {
  "project.created": (a) => `${a} created the project.`,
  "source.uploaded": (a) => `${a} added the source file.`,
  "ai.generation.started": () => "AI generation started.",
  "ai.generation.completed": () => "The AI draft (video, guide and article) was generated.",
  "content.edited": (a, v) => `${a} edited version ${v}.`,
  "version.created": (a, v) => `${a} started version ${v} from the approved version.`,
  "review.submitted": (a, v) => `${a} submitted version ${v} for review.`,
  "comment.added": (a) => `${a} added a comment.`,
  "comment.resolved": (a) => `${a} resolved a comment.`,
  "approval.granted": (a, v) => `${a} approved version ${v}.`,
  "approval.rejected": (a, v) => `${a} requested changes to version ${v}.`,
  "content.published": (a, v) => `${a} published version ${v}.`,
  "content.downloaded": (a) => `${a} tried to download the content.`,
  "video.chosen": (a, v) => `${a} chose the video to publish with version ${v}.`,
};

export default async function ActivityTab({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePageSession();
  const { id } = await params;
  const p = await getProjectOr404(s, id);
  const events = await db.auditEvent.findMany({ where: { resourceId: p.id, workspaceId: s.workspace.id }, orderBy: { occurredAt: "desc" }, take: 100 });
  if (!events.length) return <div className="card"><EmptyState icon={Clock3} title="No activity yet">Edits, comments, approvals and publications appear here.</EmptyState></div>;
  return (
    <div className="card">
      <ul className="list">
        {events.map((e) => (
          <li key={e.id}>
            <span className="avatar" style={{ width: 28, height: 28, fontSize: 11 }} aria-hidden>{e.actorName.split(" ").map((w) => w[0]).join("").slice(0, 2)}</span>
            <div style={{ flex: 1 }}>
              <div>{(ACTIVITY_TEMPLATES[e.action] ?? ((a: string) => `${a}: ${e.action}`))(e.actorName, e.resourceVersion)}{e.resourceLabel !== p.title && <span className="meta"> · {e.resourceLabel}</span>}</div>
              {e.justification && <div className="meta">“{e.justification}”</div>}
              <div className="meta">{relativeTime(e.occurredAt)}</div>
            </div>
            {e.outcome !== "success" && <TonePill tone="err">{e.outcome === "denied" ? "Denied" : "Failed"}</TonePill>}
          </li>
        ))}
      </ul>
    </div>
  );
}

import { requirePageSession } from "@/lib/auth/session";
import { db } from "@/lib/database/client";
import { mmss, relativeTime } from "@/lib/utilities/format";
import { getProjectOr404 } from "@/server/queries";
import { CommentThread, DecisionPanel } from "@/components/governance/review-panel";
import { ReviewFlagsPanel } from "@/components/governance/review-flags";
import { isMediaSource } from "@/lib/domain/constants";

const FLOW: [string, string[]][] = [
  ["Creator review", ["draft", "ai-generated", "creator-review", "changes-requested"]],
  ["SME review", ["sme-review"]],
  ["Approval", ["approval-pending", "compliance-review"]],
  ["Approved", ["approved"]],
  ["Published", ["published"]],
];

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePageSession();
  const { id } = await params;
  const p = await getProjectOr404(s, id);
  const [comments, steps, scenes, openReview, history, flags] = await Promise.all([
    db.comment.findMany({ where: { projectId: p.id }, include: { author: true }, orderBy: { createdAt: "asc" } }),
    db.guideStep.findMany({ where: { projectId: p.id }, orderBy: { order: "asc" }, select: { id: true, order: true, title: true } }),
    db.scene.findMany({ where: { projectId: p.id }, orderBy: { order: "asc" }, select: { id: true, order: true, startSec: true } }),
    db.reviewRequest.findFirst({ where: { projectId: p.id, status: "open" }, include: { assignee: true } }),
    db.reviewRequest.findMany({ where: { projectId: p.id, status: { not: "open" } }, include: { assignee: true }, orderBy: { createdAt: "desc" }, take: 5 }),
    db.reviewFlag.findMany({ where: { projectId: p.id }, orderBy: [{ status: "desc" }, { createdAt: "asc" }] }),
  ]);
  const stepLabel = (id: string | null) => { const st = steps.find((x) => x.id === id); return st ? `Step ${st.order + 1}: ${st.title}` : null; };
  const anchors = [
    { value: "project", label: "Whole project", type: "project" as const },
    ...steps.map((st) => ({ value: `step-${st.id}`, label: `Step ${st.order + 1}: ${st.title}`, type: "step" as const, ref: st.id })),
    ...(isMediaSource(p.sourceKind) ? scenes : []).map((sc) => ({ value: `scene-${sc.id}`, label: `Scene ${sc.order + 1} · ${mmss(sc.startSec)}`, type: "scene" as const, ref: sc.id, ts: sc.startSec })),
  ];
  const canDecide = !!openReview && s.permissions.has("review.approve") && (openReview.assigneeId === s.user.id || s.permissions.has("workspace.manage"));
  const current = FLOW.findIndex(([, st]) => st.includes(p.status));

  return (
    <div className="split">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <ReviewFlagsPanel canDecide={s.permissions.has("review.comment") || s.permissions.has("project.edit")} flags={flags.map((f) => ({ id: f.id, kind: f.kind, quote: f.quote, note: f.note, status: f.status, stepLabel: stepLabel(f.stepId) }))} />
      <CommentThread projectId={p.id} canComment={s.permissions.has("review.comment")} anchors={anchors}
        comments={comments.map((c) => ({ id: c.id, author: c.author.displayName, initials: c.author.initials, body: c.body, anchor: c.anchorLabel ?? (c.anchorType === "project" ? "Whole project" : c.anchorType), version: c.version, at: relativeTime(c.createdAt), resolved: !!c.resolvedAt }))} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="card pad">
          <h2 className="card-h">Decision</h2>
          {canDecide && openReview ? (
            <DecisionPanel review={{ id: openReview.id, version: openReview.version }} version={p.currentVersion} stageLabel={openReview.stage === "sme" ? "SME review" : "Final approval"} />
          ) : (
            <div className="callout tip" style={{ marginTop: 8 }}>
              {openReview ? <><b>Waiting for {openReview.assignee.displayName}.</b>&nbsp;{openReview.stage === "sme" ? "SME review" : "Approval"} of version {openReview.version}, due {relativeTime(openReview.dueAt)}. {s.permissions.has("review.approve") ? "Only the assigned reviewer can decide." : "Your role can't approve."}</>
                : p.approvedVersion && ["approved", "published"].includes(p.status) ? <><b>Approved.</b>&nbsp;Version {p.approvedVersion} was approved. Editing it creates a new draft version.</>
                : <><b>Not submitted yet.</b>&nbsp;The creator submits this version for review when the draft is ready.</>}
            </div>
          )}
        </div>
        <div className="card pad">
          <h2 className="card-h">Workflow</h2>
          <ol className="wf">{FLOW.map(([label], i) => <li key={label} className={i < current ? "done" : i === current ? "on" : ""} aria-current={i === current ? "step" : undefined}>{label}</li>)}</ol>
        </div>
        {history.length > 0 && (
          <div className="card pad">
            <h2 className="card-h">Decisions</h2>
            <ul className="list" style={{ marginTop: 6 }}>{history.map((r) => (
              <li key={r.id} style={{ padding: "8px 0", alignItems: "flex-start" }}>
                <div><b>v{r.version}</b> · {r.stage === "sme" ? "SME review" : "Approval"} · {r.status.replace("-", " ")} by {r.assignee.displayName}{r.decidedAt ? ` · ${relativeTime(r.decidedAt)}` : ""}{r.justification && <div className="meta">“{r.justification}”</div>}</div>
              </li>
            ))}</ul>
          </div>
        )}
      </div>
    </div>
  );
}

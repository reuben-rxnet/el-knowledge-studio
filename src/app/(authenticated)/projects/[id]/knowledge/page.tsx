import Link from "next/link";
import { requirePageSession } from "@/lib/auth/session";
import { db } from "@/lib/database/client";
import { isMediaSource } from "@/lib/domain/constants";
import { formatDate, mmss } from "@/lib/utilities/format";
import { getProjectOr404 } from "@/server/queries";
import { AiLabel } from "@/components/common/badges";
import { QuizReview } from "@/components/governance/quiz-review";

const parseJson = <T,>(j: string, fallback: T): T => { try { return JSON.parse(j) as T; } catch { return fallback; } };
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export default async function KnowledgeTab({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePageSession();
  const { id } = await params;
  const p = await getProjectOr404(s, id);
  const [steps, faqs, scenes, quiz, source] = await Promise.all([
    db.guideStep.findMany({ where: { projectId: p.id }, orderBy: { order: "asc" } }),
    db.faqItem.findMany({ where: { projectId: p.id } }),
    db.scene.findMany({ where: { projectId: p.id }, orderBy: { order: "asc" } }),
    db.quizQuestion.findMany({ where: { projectId: p.id }, orderBy: { order: "asc" } }),
    db.sourceAsset.findFirst({ where: { projectId: p.id }, orderBy: { createdAt: "desc" } }),
  ]);
  const media = isMediaSource(p.sourceKind);
  const sceneFor = (sec: number) => scenes.find((sc) => sec >= sc.startSec && sec < sc.endSec)?.id;
  // A warning that repeats across steps is listed once.
  const warnings = [...new Map(steps.filter((st) => st.warning).map((st) => [norm(st.warning!), st.warning!])).values()];
  const purpose = p.articlePurpose ?? `Give ${p.audience.toLowerCase()} one approved, current way to complete this process${p.sourceSystem ? ` in ${p.sourceSystem}` : ""}.`;
  const cite = (st: (typeof steps)[number]) => {
    if (media) {
      const scene = sceneFor(st.sourceSec);
      return <Link className="ts" href={`/projects/${p.id}/video${scene ? `?scene=${scene}` : ""}`}>[{mmss(st.sourceSec)}]</Link>;
    }
    return st.sourceRef ? <span className="meta">[{st.sourceRef}]</span> : null;
  };
  const stepLabel = (order: number | null) => (order === null ? null : steps[order] ? `step ${order + 1}${!media && steps[order]!.sourceRef ? ` (${steps[order]!.sourceRef})` : media ? ` · ${mmss(steps[order]!.sourceSec)}` : ""}` : `step ${order + 1}`);

  return (
    <div className="split">
      <article className="card pad article">
        <div className="row between"><span className="eyebrow">Knowledge article · v{p.currentVersion}</span><AiLabel /></div>
        <h2 className="sec-h">{p.title}</h2>
        <p>{p.articleSummary ?? p.description}</p>
        <h3 className="card-h">Purpose</h3>
        <p>{purpose}</p>
        {p.prerequisites && <><h3 className="card-h">Before you start</h3><p>{p.prerequisites}</p></>}
        <h3 className="card-h">Procedure</h3>
        <ol>{steps.map((st) => <li key={st.id}><b>{st.title}.</b> {st.instruction} {cite(st)}</li>)}</ol>
        {warnings.length > 0 && <><h3 className="card-h">Warnings</h3><ul>{warnings.map((w) => <li key={w}>{w}</li>)}</ul></>}
        <h3 className="card-h">Frequently asked questions</h3>
        {faqs.length ? faqs.map((f) => <p key={f.id}><b>{f.question}</b><br />{f.answer}</p>) : <p className="meta">No FAQs generated.</p>}
        <p className="meta">
          Owner {p.owner.displayName} · Effective {p.effectiveAt ? formatDate(p.effectiveAt) : "on approval"} · Review {p.nextReviewAt ? formatDate(p.nextReviewAt) : "—"} ·{" "}
          Source: {media ? "recording, timestamps above" : source ? `${source.fileName}${steps.some((st) => st.sourceRef) ? ", pages and sections cited above" : ""}` : "creator's notes"}
        </p>
      </article>
      <QuizReview canEdit={s.permissions.has("project.edit")} canApprove={s.permissions.has("review.approve")}
        questions={quiz.map((q) => ({ id: q.id, order: q.order, kind: q.kind, difficulty: q.difficulty, question: q.question, options: parseJson<string[]>(q.options, []), correct: parseJson<number[]>(q.correct, []), explanation: q.explanation, objective: q.objective, source: stepLabel(q.sourceStepOrder), status: q.reviewStatus }))} />
    </div>
  );
}

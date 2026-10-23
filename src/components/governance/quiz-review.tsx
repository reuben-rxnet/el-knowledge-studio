"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Pencil, Trash2 } from "lucide-react";
import { decideQuizQuestion, editQuizQuestion } from "@/server/actions/quality";
import { TonePill } from "@/components/common/badges";
import { useToast } from "@/components/common/toast";

export interface QuizView { id: string; order: number; kind: string; difficulty: string; question: string; options: string[]; correct: number[]; explanation: string; objective: string; source: string | null; status: string }

function Question({ q, i, canEdit, canApprove }: { q: QuizView; i: number; canEdit: boolean; canApprove: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(q);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>, msg: string) => start(async () => {
    const r = await fn();
    if (!r.ok) { setErr(r.error?.message ?? "That didn't work."); return; }
    setErr(null); setEditing(false); toast(msg); router.refresh();
  });
  const toggleCorrect = (k: number) => setDraft((d) => ({ ...d, correct: d.kind === "multiple" ? (d.correct.includes(k) ? d.correct.filter((x) => x !== k) : [...d.correct, k]) : [k] }));

  return (
    <div className="para" style={{ marginTop: 10 }}>
      <div className="row between">
        <span className="meta">Q{i + 1} · {q.kind.replace("-", "/")} · {q.difficulty}</span>
        <TonePill tone={q.status === "approved" ? "ok" : "warn"}>{q.status === "approved" ? "Approved" : "Needs review"}</TonePill>
      </div>
      {editing ? (
        <div style={{ display: "grid", gap: 8 }}>
          <label className="f">Question<textarea rows={2} value={draft.question} onChange={(e) => setDraft({ ...draft, question: e.target.value })} /></label>
          <fieldset style={{ border: 0, margin: 0, padding: 0, display: "grid", gap: 6 }}>
            <legend className="meta" style={{ fontWeight: 600 }}>Options: tick the correct answer{draft.kind === "multiple" ? "s" : ""}</legend>
            {draft.options.map((o, k) => (
              <div key={k} className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                <input type={draft.kind === "multiple" ? "checkbox" : "radio"} name={`correct-${q.id}`} checked={draft.correct.includes(k)} onChange={() => toggleCorrect(k)} aria-label={`Option ${k + 1} is correct`} />
                <input type="text" value={o} aria-label={`Option ${k + 1}`} onChange={(e) => setDraft({ ...draft, options: draft.options.map((x, j) => (j === k ? e.target.value : x)) })} />
              </div>
            ))}
          </fieldset>
          <label className="f">Explanation<textarea rows={2} value={draft.explanation} onChange={(e) => setDraft({ ...draft, explanation: e.target.value })} /></label>
          <div className="row">
            <button className="btn sm primary" disabled={pending} onClick={() => act(() => editQuizQuestion({ questionId: q.id, question: draft.question, options: draft.options, correct: draft.correct, explanation: draft.explanation }), "Question saved. It needs approval again.")}>Save</button>
            <button className="btn sm ghost" onClick={() => { setDraft(q); setEditing(false); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <b>{q.question}</b>
          <ol type="A" style={{ margin: "4px 0 0", paddingLeft: 20 }}>
            {q.options.map((o, k) => <li key={k} style={q.correct.includes(k) ? { fontWeight: 600 } : undefined}>{o}{q.correct.includes(k) ? " (correct)" : ""}</li>)}
          </ol>
          <div className="meta">{q.explanation} · Objective: {q.objective}{q.source ? ` · Source: ${q.source}` : ""}</div>
        </>
      )}
      {err && <span className="field-error" role="alert">{err}</span>}
      {!editing && (canEdit || canApprove) && (
        <div className="row" style={{ gap: 6 }}>
          {canApprove && q.status !== "approved" && <button className="btn sm" disabled={pending} onClick={() => act(() => decideQuizQuestion({ questionId: q.id, decision: "approve" }), "Question approved.")}><Check size={13} aria-hidden /> Approve</button>}
          {canEdit && <button className="btn sm ghost" onClick={() => setEditing(true)}><Pencil size={13} aria-hidden /> Edit</button>}
          {canEdit && <button className="btn sm ghost danger" disabled={pending} onClick={() => act(() => decideQuizQuestion({ questionId: q.id, decision: "remove" }), "Question removed.")}><Trash2 size={13} aria-hidden /> Remove</button>}
        </div>
      )}
    </div>
  );
}

export function QuizReview({ questions, canEdit, canApprove }: { questions: QuizView[]; canEdit: boolean; canApprove: boolean }) {
  const approved = questions.filter((q) => q.status === "approved").length;
  return (
    <div className="card pad">
      <div className="row between"><h2 className="card-h">Quiz</h2><span className="meta">{approved} of {questions.length} approved</span></div>
      <p className="meta" style={{ margin: "4px 0 0" }}>AI-drafted questions can&apos;t be used until a reviewer approves each one. Editing a question sends it back for approval.</p>
      {questions.length ? questions.map((q, i) => <Question key={q.id} q={q} i={i} canEdit={canEdit} canApprove={canApprove} />) : <p className="meta">No quiz questions yet. They&apos;re drafted during processing.</p>}
    </div>
  );
}

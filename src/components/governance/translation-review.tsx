"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { editTranslationSegment, markSegmentsReviewed, setTranslationApproval } from "@/server/actions/quality";
import { AiLabel, TonePill } from "@/components/common/badges";
import { useToast } from "@/components/common/toast";

interface Seg { id: string; part: string; sourceText: string; text: string; status: string }

export function TranslationReview({ projectId, language, languageName, sourceName, rtl, approved, canEdit, segments }: {
  projectId: string; language: string; languageName: string; sourceName: string; rtl: boolean; approved: boolean; canEdit: boolean; segments: Seg[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const reviewed = segments.filter((s) => s.status === "reviewed").length;
  const editable = canEdit && !approved;
  const act = (fn: () => Promise<{ ok: boolean; error?: { message: string } }>, msg: string) => start(async () => {
    const r = await fn();
    if (!r.ok) { setErr(r.error?.message ?? "That didn't work."); return; }
    setErr(null); toast(msg); router.refresh();
  });

  return (
    <div className="card">
      <div className="pad row between">
        <div>
          <h2 className="card-h">{sourceName} → {languageName}</h2>
          <span className="meta">{reviewed} of {segments.length} segments reviewed by a person</span>
        </div>
        <div className="row">
          {approved ? <TonePill tone="ok">Approved</TonePill> : <AiLabel>Machine translation · needs regional review</AiLabel>}
          {canEdit && !approved && reviewed < segments.length && <button className="btn sm" disabled={pending} onClick={() => act(() => markSegmentsReviewed({ projectId, language }), `All ${languageName} segments marked reviewed.`)}>Mark all reviewed</button>}
          {canEdit && !approved && <button className="btn sm primary" disabled={pending || reviewed < segments.length} title={reviewed < segments.length ? "Review every segment first" : undefined} onClick={() => act(() => setTranslationApproval({ projectId, language, approve: true }), `${languageName} approved. It can now be published.`)}><Check size={14} aria-hidden /> Approve {languageName}</button>}
          {canEdit && approved && <button className="btn sm" disabled={pending} onClick={() => act(() => setTranslationApproval({ projectId, language, approve: false }), `${languageName} reopened for changes.`)}>Reopen</button>}
        </div>
      </div>
      {err && <div className="callout warn" role="alert" style={{ margin: "0 20px 12px" }}><b>{err}</b></div>}
      <div className="tablewrap">
        <table>
          <caption className="sr">Source and translated text side by side</caption>
          <thead><tr><th scope="col">Part</th><th scope="col">{sourceName}</th><th scope="col">{languageName}</th><th scope="col">Status</th></tr></thead>
          <tbody>
            {segments.map((seg) => (
              <tr key={seg.id}>
                <td className="meta" style={{ whiteSpace: "nowrap" }}>{seg.part}</td>
                <td>{seg.sourceText}</td>
                <td lang={language} dir={rtl ? "rtl" : undefined} style={{ minWidth: 240 }}>
                  {editable ? (
                    <>
                      <label className="sr" htmlFor={`tr-${seg.id}`}>{languageName} translation of: {seg.sourceText.slice(0, 60)}</label>
                      <textarea id={`tr-${seg.id}`} rows={2} key={seg.text} defaultValue={seg.text}
                        onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== seg.text) act(() => editTranslationSegment({ segmentId: seg.id, text: v }), "Translation saved and marked reviewed."); }} />
                    </>
                  ) : seg.text}
                </td>
                <td>{seg.status === "reviewed" ? <TonePill tone="ok">Reviewed</TonePill> : <TonePill tone="ai">Machine</TonePill>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editable && <p className="meta pad" style={{ margin: 0 }}>Edit any translation to correct it. Saving marks that segment reviewed. Approve the language when every segment has been checked.</p>}
    </div>
  );
}

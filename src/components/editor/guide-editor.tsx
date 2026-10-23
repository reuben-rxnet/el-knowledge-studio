"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2, Video } from "lucide-react";
import { mmss } from "@/lib/utilities/format";
import { addStep, deleteStep, moveStep, updateStep } from "@/server/actions/content";
import type { ActionResult } from "@/server/actions/result";
import { AiLabel, TonePill } from "@/components/common/badges";
import { useToast } from "@/components/common/toast";
import { CaptureScreenshots } from "./capture-screenshots";

interface Step { id: string; order: number; chapter: string; title: string; instruction: string; expectedResult: string | null; warning: string | null; tip: string | null; altText: string; sourceSec: number; sourceRef: string | null; shotVersion: string | null; redact: boolean; origin: string; markerX: number; markerY: number; sceneId: string | null; flags: { kind: string; note: string }[] }

export function GuideEditor({ projectId, title, version, system, steps, canEdit, initialStepId, media, hasRecording }: {
  projectId: string; title: string; version: number; system: string; steps: Step[]; canEdit: boolean; initialStepId?: string; media: boolean; hasRecording: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [sel, setSel] = useState(steps.find((s) => s.id === initialStepId)?.id ?? steps[0]?.id);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const step = steps.find((s) => s.id === sel) ?? steps[0];
  const chapters = [...new Set(steps.map((s) => s.chapter))];

  function act(fn: () => Promise<ActionResult<{ newVersion: boolean; version: number }>>, success?: string, after?: (d: unknown) => void) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) { setError(r.error.message); return; }
      if (r.data.newVersion) toast(`Version ${r.data.version} draft created. The approved version stays live until this one is approved.`);
      else if (success) toast(success);
      after?.(r.data);
      router.refresh();
    });
  }

  function save(s: Step, patch: Partial<Pick<Step, "title" | "instruction" | "warning" | "tip">>) {
    const next = { ...s, ...patch };
    if (next.title === s.title && next.instruction === s.instruction && next.warning === s.warning && next.tip === s.tip) return;
    act(() => updateStep({ stepId: s.id, title: next.title, instruction: next.instruction, warning: next.warning ?? undefined, tip: next.tip ?? undefined, expectedVersion: version }), "Step saved.");
  }

  if (!step) return <div className="callout tip"><b>No guide steps yet.</b>&nbsp;Steps appear after processing completes.</div>;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {error && <div className="callout warn" role="alert"><b>{error}</b></div>}
      <div className="editor">
        <nav className="card" style={{ padding: 8 }} aria-label="Guide outline">
          <div className="eyebrow" style={{ padding: 8 }}>Outline</div>
          {chapters.map((c) => (
            <div key={c}>
              <div style={{ padding: "6px 8px 2px", fontWeight: 650, fontSize: 13 }}>{c}</div>
              {steps.filter((s) => s.chapter === c).map((s) => (
                <button key={s.id} className={`scene${s.id === step.id ? " sel" : ""}`} aria-current={s.id === step.id ? "true" : undefined} onClick={() => setSel(s.id)}>
                  <span className="no">{s.order + 1}</span><span style={{ fontSize: 13 }}>{s.title}</span>
                </button>
              ))}
            </div>
          ))}
          {canEdit && <button className="btn sm" style={{ margin: 8 }} disabled={pending} onClick={() => act(() => addStep({ projectId, afterOrder: step.order, expectedVersion: version }), "Step added.", (d) => setSel((d as { stepId: string }).stepId))}><Plus size={14} aria-hidden /> Add step</button>}
        </nav>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <div className="card pad">
            <div className="row between"><div><span className="eyebrow">Standard operating procedure · v{version}</span><h2 className="sec-h" style={{ marginTop: 4 }}>{title}</h2></div><AiLabel>AI draft · review required</AiLabel></div>
            {system && <div className="callout tip" style={{ marginTop: 12 }}><b>Before you start:</b>&nbsp;You need access to {system} with your role.</div>}
          </div>
          {steps.map((s) => (
            <article key={s.id} className={`stepcard${s.id === step.id ? " sel" : ""}`} onFocusCapture={() => setSel(s.id)} onClick={() => setSel(s.id)} aria-labelledby={`st-${s.id}`}>
              <span className="stepnum" aria-hidden>{s.order + 1}</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
                <div className="row between">
                  <label className="sr" htmlFor={`st-${s.id}`}>Step {s.order + 1} title</label>
                  <input id={`st-${s.id}`} className="card-h" key={s.title} defaultValue={s.title} readOnly={!canEdit} style={{ border: 0, padding: 0, flex: 1, minWidth: 160, background: "transparent" }}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v) save(s, { title: v }); }} />
                  <div className="row" style={{ gap: 6 }}>
                    {s.origin === "human" ? <TonePill tone="info">Edited</TonePill> : <AiLabel />}
                    {s.flags.length > 0 && <Link href={`/projects/${projectId}/review`} title={s.flags.map((x) => x.note).join(" · ")}><TonePill tone={s.flags.some((x) => x.kind === "risky" || x.kind === "contradiction") ? "err" : "warn"}>{s.flags.length} AI flag{s.flags.length === 1 ? "" : "s"}</TonePill></Link>}
                    {media ? <Link className="ts" href={`/projects/${projectId}/video${s.sceneId ? `?scene=${s.sceneId}` : ""}`}><Video size={12} aria-hidden /> {mmss(s.sourceSec)}</Link> : s.sourceRef ? <span className="meta">{s.sourceRef}</span> : null}
                  </div>
                </div>
                <label className="sr" htmlFor={`si-${s.id}`}>Step {s.order + 1} instruction</label>
                <textarea id={`si-${s.id}`} key={s.instruction} defaultValue={s.instruction} readOnly={!canEdit} rows={2} onBlur={(e) => { const v = e.target.value.trim(); if (v) save(s, { instruction: v }); }} />
                {s.shotVersion ? (
                  // eslint-disable-next-line @next/next/no-img-element -- authenticated API image, not a static asset
                  <img src={`/api/steps/${s.id}/screenshot?v=${s.shotVersion}`} alt={s.altText} style={{ width: "100%", borderRadius: 8, border: "1px solid var(--border)" }} loading="lazy" />
                ) : (
                  <figure className="shot" style={{ margin: 0 }} role="img" aria-label={`Placeholder: ${s.altText}`}>
                    <span className="win" />
                    <span className="box" style={{ left: `${s.markerX - 6}%`, top: `${s.markerY - 8}%`, width: "20%", height: "22%" }} />
                    <span className="marker" style={{ left: `${s.markerX + 12}%`, top: `${s.markerY - 14}%` }}>{s.order + 1}</span>
                  </figure>
                )}
                {s.warning && <div className="callout warn"><b>Warning</b>&nbsp;{s.warning}</div>}
                {s.tip && <div className="callout tip"><b>Tip</b>&nbsp;{s.tip}</div>}
                {s.expectedResult && <p className="meta" style={{ margin: 0 }}><b>Expected result:</b> {s.expectedResult}</p>}
              </div>
            </article>
          ))}
        </div>

        <aside style={{ display: "flex", flexDirection: "column", gap: 12 }} aria-label="Step properties">
          <div className="card pad" style={{ display: "grid", gap: 10 }}>
            <div className="eyebrow">Step {step.order + 1} properties</div>
            <label className="f">Warning<textarea id="stepWarn" key={`w${step.id}${step.warning}`} defaultValue={step.warning ?? ""} readOnly={!canEdit} rows={2} onBlur={(e) => save(step, { warning: e.target.value.trim() || null })} /></label>
            <label className="f">Tip<textarea id="stepTip" key={`t${step.id}${step.tip}`} defaultValue={step.tip ?? ""} readOnly={!canEdit} rows={2} onBlur={(e) => save(step, { tip: e.target.value.trim() || null })} /></label>
            <label className="f">Alternative text<input type="text" id="stepAlt" value={step.altText} readOnly /></label>
            {canEdit && (
              <div className="row">
                <button className="btn sm" disabled={pending || step.order === 0} onClick={() => act(() => moveStep({ stepId: step.id, direction: -1, expectedVersion: version }))}><ArrowUp size={14} aria-hidden /> Move up</button>
                <button className="btn sm" disabled={pending || step.order === steps.length - 1} onClick={() => act(() => moveStep({ stepId: step.id, direction: 1, expectedVersion: version }))}><ArrowDown size={14} aria-hidden /> Move down</button>
                <button className="btn sm danger" disabled={pending || steps.length < 2} onClick={() => act(() => deleteStep({ stepId: step.id, expectedVersion: version }), "Step deleted. It's still in earlier versions.", () => setSel(undefined))}><Trash2 size={14} aria-hidden /> Delete</button>
              </div>
            )}
          </div>
          <div className="card pad">
            <div className="eyebrow">Screenshot tools</div>
            {hasRecording ? (
              <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                {canEdit && <CaptureScreenshots projectId={projectId} steps={steps.map((x) => ({ id: x.id, sourceSec: x.sourceSec, redact: x.redact }))} />}
                <p className="meta" style={{ margin: 0 }}>Takes one frame per step from the recording. Steps in scenes marked for redaction are blurred. Check every screenshot for personal or confidential data.</p>
              </div>
            ) : <p className="meta" style={{ margin: "6px 0 0" }}>Screenshots come from a recording. This project was created from a document, so placeholders are shown.</p>}
            <p className="meta" style={{ margin: "6px 0 0" }}>Drawing markers, arrows and boxes on screenshots comes with the annotation editor (planned).</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

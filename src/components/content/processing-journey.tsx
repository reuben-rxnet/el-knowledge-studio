"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowRight, Check, RotateCcw } from "lucide-react";
import { PHASES, STAGES, type JobSnapshot } from "@/lib/services/processing-plan";
import { cancelJob, retryJob } from "@/server/actions/projects";

const PHASE_COPY: Record<string, string> = {
  Capture: "Securing your source",
  Understanding: "Reading the screen",
  Transcription: "Listening to your narration",
  "Knowledge Extraction": "Finding the process",
  "Content Creation": "Writing the video, guide and captions",
  Localization: "Preparing translations",
  "Quality Review": "Checking the result",
};

type Poll = JobSnapshot & { projectStatus: string; technical?: { correlationId: string; attempt: number; kind: string; errorCode?: string | null } };

export function ProcessingJourney({ projectId, jobId, canEdit, aiLabel }: { projectId: string; jobId: string; canEdit: boolean; aiLabel: string }) {
  const router = useRouter();
  const [data, setData] = useState<Poll | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const lastPhase = useRef<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [confirmRegen, setConfirmRegen] = useState(false);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        const body = await res.json();
        if (!res.ok) { setError(body.message ?? "Progress is unavailable right now."); return; }
        setError(null);
        setData(body);
        const running = (body as Poll).stages.find((s) => s.status === "running");
        if (running && running.phase !== lastPhase.current) { lastPhase.current = running.phase; setAnnounce(`Now: ${running.phase}. ${(body as Poll).percent}% complete.`); }
        if (["succeeded", "partial", "failed", "cancelled"].includes(body.status)) { setAnnounce(body.status === "succeeded" || body.status === "partial" ? "Processing complete. Your draft is ready." : "Processing stopped."); router.refresh(); return; }
      } catch {
        setError("You appear to be offline. Progress will resume when the connection returns.");
      }
      if (!stop) timer = setTimeout(tick, 1200);
    };
    void tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [jobId, router]);

  const pct = data?.percent ?? 0;
  const done = data?.status === "succeeded" || data?.status === "partial";
  const partial = data?.status === "partial";
  const failed = data?.status === "failed";
  const cancelled = data?.status === "cancelled";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1000 }}>
      <p className="sr" aria-live="polite">{announce}</p>
      {error && <div className="callout warn" role="alert"><b>{error}</b></div>}
      <div className="card journey">
        <div className="beam" aria-hidden><i style={{ height: `${pct}%` }} /></div>
        {PHASES.map((phase) => {
          const stages = (data?.stages ?? STAGES.map((s) => ({ ...s, status: "queued" as const, percent: 0, detail: undefined as string | undefined }))).filter((s) => s.phase === phase);
          const st = stages.every((s) => s.status === "succeeded" || s.status === "skipped") && stages.some((s) => s.status === "succeeded") ? "ok" : stages.every((s) => s.status === "skipped") ? "skip" : stages.some((s) => s.status === "failed") ? "err" : stages.some((s) => s.status !== "queued") ? "run" : "q";
          return (
            <div key={phase} className={`jstage ${st}`}>
              <span className="jnode" aria-hidden>{st === "ok" && <Check size={14} />}</span>
              <div className="row between">
                <div><span className="eyebrow">{phase}</span><h3 className="card-h">{PHASE_COPY[phase]}</h3></div>
                <span className={`pill s-${st === "ok" ? "ok" : st === "run" ? "info" : st === "err" ? "err" : "neutral"}`}>{st === "ok" ? "Done" : st === "run" ? "Running" : st === "err" ? "Needs attention" : st === "skip" ? "Skipped" : "Queued"}</span>
              </div>
              {st !== "q" && (
                <ul className="pv" aria-label={`${phase} steps`} style={{ listStyle: "none", margin: "10px 0 0" }}>
                  {stages.map((s) => (
                    <li key={s.key} className="row between" style={{ gap: 8 }}>
                      <span><b style={{ fontWeight: 600 }}>{s.title}</b> <span className="meta">· {s.detail ?? s.explanation}</span></span>
                      <span className="meta">{s.status === "succeeded" ? "Done" : s.status === "running" ? "Working…" : s.status === "failed" ? "Failed" : s.status === "skipped" ? "Skipped" : "Queued"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      <div className="card pad row between">
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Overall progress"><i style={{ width: `${pct}%` }} /></div>
          <div className="meta" style={{ marginTop: 6 }}>
            {partial ? "Draft ready. Some optional steps need attention (see above)." : done ? "All stages complete." : failed ? "Processing failed. Your source file is kept." : cancelled ? "Processing was cancelled." : `About ${pct}% complete`} · {aiLabel}
            {data?.technical && <> · Correlation {data.technical.correlationId.slice(0, 8)} · attempt {data.technical.attempt}{data.technical.errorCode ? ` · error ${data.technical.errorCode}` : ""}</>}
          </div>
        </div>
        {done && <Link className="btn primary" href={`/projects/${projectId}/video`} data-testid="open-draft">Open the draft <ArrowRight size={16} aria-hidden /></Link>}
        {done && canEdit && (confirmRegen
          ? <span className="row" style={{ gap: 6 }}><span className="meta">Replaces the current draft, including your edits.</span><button className="btn danger" disabled={pending} onClick={() => start(async () => { const r = await retryJob(projectId); if (r.ok) window.location.reload(); else setError(r.error.message); })}>Confirm regenerate</button><button className="btn ghost" onClick={() => setConfirmRegen(false)}>Cancel</button></span>
          : <button className="btn" onClick={() => setConfirmRegen(true)}><RotateCcw size={16} aria-hidden /> Regenerate draft</button>)}
        {(failed || cancelled) && canEdit && <button className="btn primary" disabled={pending} onClick={() => start(async () => { const r = await retryJob(projectId); if (r.ok) window.location.reload(); else setError(r.error.message); })}><RotateCcw size={16} aria-hidden /> Retry processing</button>}
        {!done && !failed && !cancelled && canEdit && <button className="btn" disabled={pending} onClick={() => start(async () => { const r = await cancelJob(projectId); if (!r.ok) setError(r.error.message); })}>Cancel</button>}
      </div>
    </div>
  );
}

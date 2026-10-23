"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Lock, Sparkles, Unlock } from "lucide-react";
import { mmss } from "@/lib/utilities/format";
import { rewriteScript, toggleScriptLock, updateScene, updateScript } from "@/server/actions/content";
import { AiLabel, TonePill } from "@/components/common/badges";
import { useToast } from "@/components/common/toast";
import type { ActionResult } from "@/server/actions/result";
import { MediaPlayer } from "./media-player";

interface Scene { id: string; title: string; startSec: number; endSec: number; focusZoom: boolean; redaction: boolean }
interface Segment { id: string; startSec: number; endSec: number; originalText: string; text: string; origin: string; locked: boolean; flagged: string | null }
type Rewrite = "shorten" | "simplify" | "professional" | "instructional" | "expand";

export function VideoEditor({ projectId, version, duration, scenes, script, canEdit, aiLabel, initialSceneId, hasRecording, languages }: {
  projectId: string; version: number; duration: number; scenes: Scene[]; script: Segment[]; canEdit: boolean; aiLabel: string; initialSceneId?: string;
  hasRecording: boolean; languages: { code: string; label: string; texts: Record<string, string> }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [sel, setSel] = useState(scenes.find((s) => s.id === initialSceneId)?.id ?? scenes[0]?.id);
  const [showOriginal, setShowOriginal] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const scene = scenes.find((s) => s.id === sel) ?? scenes[0];
  const idx = scene ? scenes.indexOf(scene) : 0;

  function act(key: string, fn: () => Promise<ActionResult<{ newVersion: boolean; version: number }>>, success?: string) {
    setBusy(key); setError(null);
    start(async () => {
      const r = await fn();
      setBusy(null);
      if (!r.ok) { setError(r.error.message); return; }
      if (r.data.newVersion) toast(`Version ${r.data.version} draft created. The approved version stays live until this one is approved.`);
      else if (success) toast(success);
      router.refresh();
    });
  }

  if (!scene) return <div className="callout tip"><b>No scenes yet.</b>&nbsp;Scenes appear after processing completes.</div>;
  const pct = (s: Scene) => `${((s.endSec - s.startSec) / Math.max(duration, 1)) * 100}%`;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="edtool row between">
        <div className="row"><span className="meta"><Check size={14} aria-hidden /> {pending ? "Saving…" : "All changes saved"}</span><span className="meta">Version {version}</span></div>
        <div className="row"><AiLabel>{aiLabel}</AiLabel></div>
      </div>
      {error && <div className="callout warn" role="alert"><b>{error}</b></div>}
      <div className="editor">
        <nav className="card" style={{ padding: 8 }} aria-label="Chapters">
          <div className="eyebrow" style={{ padding: 8 }}>Chapters</div>
          {scenes.map((s, i) => (
            <button key={s.id} className={`scene${s.id === scene.id ? " sel" : ""}`} aria-current={s.id === scene.id ? "true" : undefined} onClick={() => setSel(s.id)}>
              <span className="no">{i + 1}</span>
              <span style={{ flex: 1 }}><span style={{ display: "block", fontWeight: 600, fontSize: 13 }}>{s.title}</span><span className="meta">{mmss(s.startSec)} – {mmss(s.endSec)}</span></span>
            </button>
          ))}
        </nav>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <MediaPlayer projectId={projectId} hasRecording={hasRecording} duration={duration} scenes={scenes} sceneId={scene.id} onScene={setSel}
            segments={script.map((x) => ({ id: x.id, startSec: x.startSec, endSec: x.endSec, text: x.text }))} languages={languages} />

          <div className="card timeline" role="group" aria-label="Timeline">
            {([["Video", "v"], ["Narration", "n"], ["Captions", "c"], ["Zoom", "z"], ["Redaction", "r"]] as const).map(([label, c]) => (
              <div key={c} className="track">
                <span className="tl">{label}</span>
                <div className="lane">
                  {scenes.map((s, i) => {
                    const show = c === "z" ? s.focusZoom : c === "r" ? s.redaction : true;
                    const text = c === "v" ? `Scene ${i + 1}` : c === "n" ? "AI voice" : c === "c" ? "Captions" : c === "z" ? "Focus zoom" : "Blur";
                    return <span key={s.id} style={{ width: pct(s), display: "flex" }}>{show && <button className={`clip ${c}${s.id === scene.id ? " sel" : ""}`} style={{ width: "100%" }} onClick={() => setSel(s.id)} aria-label={`${label}: ${s.title}`}>{text}</button>}</span>;
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="card pad">
            <div className="row between">
              <h2 className="card-h">Script</h2>
              <button className="btn sm" aria-pressed={showOriginal} onClick={() => setShowOriginal((x) => !x)}>{showOriginal ? "Hide" : "Compare with"} original transcript</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
              {script.map((s, i) => (
                <div key={s.id} className={`para${i === idx ? " active" : ""}`}>
                  <div className="row between">
                    <button className="ts" onClick={() => scenes[i] && setSel(scenes[i]!.id)}>{mmss(s.startSec)}</button>
                    <div className="row" style={{ gap: 6 }}>
                      {s.locked ? <TonePill tone="ok">Approved text · locked</TonePill> : s.origin === "human" ? <TonePill tone="info">Edited by a person</TonePill> : <AiLabel>{s.origin === "ai-edited" ? "AI-edited" : "AI generated"}</AiLabel>}
                      {s.flagged && <TonePill tone="warn">Check term: {s.flagged}</TonePill>}
                    </div>
                  </div>
                  {showOriginal && <div className="meta" style={{ fontSize: 13 }}><b>Original transcript:</b> {s.originalText}</div>}
                  <label className="sr" htmlFor={`seg-${s.id}`}>Script paragraph {i + 1}</label>
                  <textarea id={`seg-${s.id}`} defaultValue={s.text} key={s.text} readOnly={!canEdit || s.locked} rows={2}
                    onBlur={(e) => { const t = e.target.value.trim(); if (canEdit && !s.locked && t && t !== s.text) act(`save-${s.id}`, () => updateScript({ segmentId: s.id, text: t, expectedVersion: version }), "Script paragraph saved."); }} />
                  {canEdit && (
                    <div className="row" style={{ gap: 6 }}>
                      {(["shorten", "simplify", "professional", "instructional"] as Rewrite[]).map((k) => (
                        <button key={k} className="btn sm ghost" disabled={s.locked || busy !== null} onClick={() => act(`${k}-${s.id}`, () => rewriteScript({ segmentId: s.id, instruction: k, expectedVersion: version }), "AI rewrite applied and labelled. The original transcript is kept.")}>
                          <Sparkles size={13} aria-hidden /> {busy === `${k}-${s.id}` ? "Rewriting…" : { shorten: "Shorten", simplify: "Simplify", professional: "More professional", instructional: "Instructional tone", expand: "Expand" }[k]}
                        </button>
                      ))}
                      <button className="btn sm ghost" disabled={busy !== null} onClick={() => act(`lock-${s.id}`, () => toggleScriptLock({ segmentId: s.id, expectedVersion: version }))}>
                        {s.locked ? <><Unlock size={13} aria-hidden /> Unlock</> : <><Lock size={13} aria-hidden /> Lock as approved</>}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <aside style={{ display: "flex", flexDirection: "column", gap: 12 }} aria-label="Properties">
          <div className="card pad">
            <div className="eyebrow">Scene properties</div>
            <label className="f" style={{ marginTop: 8 }}>Chapter title
              <input type="text" id="sceneTitle" key={scene.id + scene.title} defaultValue={scene.title} readOnly={!canEdit}
                onBlur={(e) => { const t = e.target.value.trim(); if (canEdit && t && t !== scene.title) act("title", () => updateScene({ sceneId: scene.id, title: t, expectedVersion: version }), "Chapter renamed."); }} />
            </label>
            <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 10 }}>
              <label className="f">Start<input type="text" id="sStart" value={mmss(scene.startSec)} readOnly /></label>
              <label className="f">End<input type="text" id="sEnd" value={mmss(scene.endSec)} readOnly /></label>
            </div>
            <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
              <label className="check"><input type="checkbox" checked={scene.focusZoom} disabled={!canEdit || pending} onChange={(e) => act("zoom", () => updateScene({ sceneId: scene.id, focusZoom: e.target.checked, expectedVersion: version }))} /><span>Focus zoom on clicks</span></label>
              <label className="check"><input type="checkbox" checked={scene.redaction} disabled={!canEdit || pending} onChange={(e) => act("redact", () => updateScene({ sceneId: scene.id, redaction: e.target.checked, expectedVersion: version }), e.target.checked ? "Redaction added." : "Redaction removed.")} /><span>Redact sensitive region<small>{scene.redaction ? "Detected region is blurred in every output." : "Blur a region that shows personal or confidential data."}</small></span></label>
            </div>
          </div>
          <div className="card pad">
            <div className="eyebrow">Voiceover</div>
            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
              <p className="meta" style={{ margin: 0 }}><b>Preview:</b> use &ldquo;Play narration&rdquo; under the player. It reads the script aloud with a voice installed on this PC, in any translated language.</p>
              <p className="meta" style={{ margin: 0 }}><b>AI voiceover:</b> not available yet. The Codex gateway has no text-to-speech model; it switches on when one is added.</p>
              <p className="meta" style={{ margin: 0 }}>Voice cloning is disabled until legal, privacy, security and employee-consent reviews are complete.</p>
            </div>
          </div>
          <div className="card pad">
            <div className="eyebrow">Branding</div>
            <div className="meta" style={{ fontSize: 13, marginTop: 6, display: "grid", gap: 4 }}><span>Intro and outro from the workspace brand kit</span><span>Watermark follows the classification</span></div>
          </div>
        </aside>
      </div>
    </div>
  );
}

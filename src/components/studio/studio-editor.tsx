"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, EyeOff, Pause, Play, Redo2, Scissors, Trash2, Undo2 } from "lucide-react";
import {
  addBlur, blursAt, clipLength, clipStarts, locate, moveClip, outputCues, outputDuration, removeBlur, removeClip, setSpeed, SPEEDS, splitAt, toOutput, trimClip, updateBlur, FPS,
  type BlurBox, type Cue, type Edl,
} from "@/lib/studio/edl";
import { saveStudioEdit } from "@/server/actions/studio";
import { StudioRenders } from "./studio-renders";

type Selection = { kind: "clip"; id: string } | { kind: "blur"; id: string } | null;
type Save = { state: "saved" | "saving" | "unsaved" } | { state: "error"; message: string };

const newId = (p: string) => `${p}${Math.random().toString(36).slice(2, 10)}`;
/** 75.4 -> "1:15.4" */
export const stamp = (sec: number) => {
  const s = Math.max(0, sec), m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${r < 10 ? "0" : ""}${r.toFixed(1)}`;
};
const TICKS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

export function StudioEditor({ projectId, initialEdl, initialRevision, mediaUrl, cues, canEdit }: {
  projectId: string; initialEdl: Edl; initialRevision: number; mediaUrl: string; cues: Cue[]; canEdit: boolean;
}) {
  // --- Edit list with undo/redo. Refs hold the latest values for event handlers; state drives the UI.
  const [edl, setEdlState] = useState(initialEdl);
  const [past, setPast] = useState<Edl[]>([]);
  const [future, setFuture] = useState<Edl[]>([]);
  const [save, setSave] = useState<Save>({ state: "saved" });
  const [changes, setChanges] = useState(0); // counts edits; drives autosave
  const edlRef = useRef(initialEdl);
  const pastRef = useRef<Edl[]>([]);
  const futureRef = useRef<Edl[]>([]);
  const commit = useCallback((next: Edl) => {
    edlRef.current = next;
    setEdlState(next);
    setChanges((n) => n + 1);
    setSave((s) => (s.state === "error" ? s : { state: "unsaved" }));
  }, []);
  const remember = useCallback(() => {
    pastRef.current = [...pastRef.current.slice(-99), edlRef.current];
    futureRef.current = [];
    setPast(pastRef.current);
    setFuture([]);
  }, []);
  const apply = useCallback((next: Edl) => { if (next !== edlRef.current) { remember(); commit(next); } }, [remember, commit]);
  /** For drags: one undo step for the whole gesture (taken at the start), live updates during it. */
  const beginGesture = remember;
  const live = useCallback((change: (e: Edl) => Edl) => commit(change(edlRef.current)), [commit]);
  const undo = useCallback(() => {
    const prev = pastRef.current.at(-1);
    if (!prev) return;
    futureRef.current = [edlRef.current, ...futureRef.current];
    pastRef.current = pastRef.current.slice(0, -1);
    setPast(pastRef.current); setFuture(futureRef.current);
    commit(prev);
  }, [commit]);
  const redo = useCallback(() => {
    const next = futureRef.current[0];
    if (!next) return;
    pastRef.current = [...pastRef.current, edlRef.current];
    futureRef.current = futureRef.current.slice(1);
    setPast(pastRef.current); setFuture(futureRef.current);
    commit(next);
  }, [commit]);

  // --- Autosave (debounced; one save in flight at a time) ------------------------------------
  const revision = useRef(initialRevision);
  const inFlight = useRef<Promise<void> | null>(null);
  const flush = useCallback(async () => {
    if (inFlight.current) await inFlight.current;
    const snapshot = edlRef.current;
    setSave({ state: "saving" });
    inFlight.current = (async () => {
      const r = await saveStudioEdit({ projectId, revision: revision.current, edl: snapshot });
      if (r.ok) { revision.current = r.data.revision; setSave(edlRef.current === snapshot ? { state: "saved" } : { state: "unsaved" }); }
      else setSave({ state: "error", message: r.error.message });
    })();
    await inFlight.current;
    inFlight.current = null;
  }, [projectId]);
  useEffect(() => {
    if (!changes || !canEdit) return;
    const t = setTimeout(() => { void flush(); }, 800);
    return () => clearTimeout(t);
  }, [changes, canEdit, flush]);

  // --- Playback across clips ------------------------------------------------------------------
  const video = useRef<HTMLVideoElement>(null);
  const [outT, setOutT] = useState(0);
  const outRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const clipIndex = useRef(0);
  const raf = useRef(0);
  const total = useMemo(() => outputDuration(edl), [edl]);
  const starts = useMemo(() => clipStarts(edl), [edl]);

  const seek = useCallback((t: number) => {
    const e = edlRef.current;
    const at = Math.min(Math.max(0, t), outputDuration(e));
    const { index, srcTime } = locate(e, at);
    clipIndex.current = index;
    outRef.current = at;
    setOutT(at);
    const v = video.current;
    if (v) { v.currentTime = srcTime; v.playbackRate = e.clips[index]!.speed; }
  }, []);

  const stop = useCallback(() => { cancelAnimationFrame(raf.current); video.current?.pause(); setPlaying(false); }, []);
  /**
   * Plays the edit, not the file: each frame, if the recording has reached the end of the current clip,
   * jump to the next clip's start at its speed; otherwise move the playhead. Cut parts are never shown.
   */
  const play = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (outRef.current >= outputDuration(edlRef.current) - 0.05) seek(0); else seek(outRef.current);
    const frame = () => {
      const e = edlRef.current, i = clipIndex.current, c = e.clips[i];
      if (!c) { stop(); return; }
      if (v.currentTime >= c.srcOut - 0.02 || v.ended) {
        if (i + 1 >= e.clips.length) { stop(); seek(outputDuration(e)); return; }
        const n = e.clips[i + 1]!;
        clipIndex.current = i + 1;
        v.currentTime = n.srcIn;
        v.playbackRate = n.speed;
        if (v.paused) void v.play().catch(() => {});
      } else {
        const t = clipStarts(e)[i]! + (v.currentTime - c.srcIn) / c.speed;
        outRef.current = t;
        setOutT(t);
      }
      raf.current = requestAnimationFrame(frame);
    };
    void v.play().then(() => { setPlaying(true); raf.current = requestAnimationFrame(frame); }).catch(() => setPlaying(false));
  }, [seek, stop]);
  const toggle = useCallback(() => (playing ? stop() : play()), [playing, play, stop]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  // After an edit, keep the playhead inside the (possibly shorter) video and on the right frame.
  useEffect(() => { if (!playing) seek(Math.min(outRef.current, total)); }, [edl, total, playing, seek]);

  // --- Where the picture sits inside the player (letterboxing), for the overlays -------------
  const stage = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const measure = useCallback(() => {
    const v = video.current, s = stage.current;
    if (!v || !s || !v.videoWidth) return;
    const W = s.clientWidth, H = s.clientHeight, ar = v.videoWidth / v.videoHeight;
    const width = Math.min(W, H * ar), height = width / ar;
    setBox({ left: (W - width) / 2, top: (H - height) / 2, width, height });
  }, []);
  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    const ro = new ResizeObserver(measure);
    ro.observe(s);
    return () => ro.disconnect();
  }, [measure]);

  // --- Selection and edits ----------------------------------------------------------------------
  const [sel, setSel] = useState<Selection>(null);
  const [captionsOn, setCaptionsOn] = useState(true);
  const here = locate(edl, outT);
  const selClip = sel?.kind === "clip" ? edl.clips.findIndex((c) => c.id === sel.id) : -1;
  const selBlur = sel?.kind === "blur" ? edl.blurs.find((b) => b.id === sel.id) ?? null : null;

  const split = useCallback(() => { if (canEdit) apply(splitAt(edlRef.current, outRef.current, newId("c"))); }, [apply, canEdit]);
  const deleteSelected = useCallback(() => {
    if (!canEdit || !sel) return;
    if (sel.kind === "clip") { const i = edlRef.current.clips.findIndex((c) => c.id === sel.id); apply(removeClip(edlRef.current, i)); }
    else apply(removeBlur(edlRef.current, sel.id));
    setSel(null);
  }, [apply, canEdit, sel]);
  const blur = useCallback(() => {
    if (!canEdit) return;
    const id = newId("b");
    apply(addBlur(edlRef.current, outRef.current, id));
    setSel({ kind: "blur", id });
  }, [apply, canEdit]);
  const step = useCallback((frames: number) => { stop(); seek(outRef.current + frames / FPS); }, [seek, stop]);

  // --- Keyboard shortcuts (not while typing in a field) ----------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable='true']")) return;
      const k = e.key.toLowerCase();
      if (k === " ") { e.preventDefault(); toggle(); }
      else if (k === "arrowleft") { e.preventDefault(); step(e.shiftKey ? -FPS : -1); }
      else if (k === "arrowright") { e.preventDefault(); step(e.shiftKey ? FPS : 1); }
      else if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if ((e.ctrlKey || e.metaKey) && k === "y") { e.preventDefault(); redo(); }
      else if (e.ctrlKey || e.metaKey || e.altKey) return;
      else if (k === "s") { e.preventDefault(); split(); }
      else if (k === "b") { e.preventDefault(); blur(); }
      else if (k === "delete" || k === "backspace") { e.preventDefault(); deleteSelected(); }
      else if (k === "home") { e.preventDefault(); seek(0); }
      else if (k === "end") { e.preventDefault(); seek(total); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, step, undo, redo, split, blur, deleteSelected, seek, total]);

  // --- Dragging blur boxes on the picture ------------------------------------------------------
  const dragBlur = (e: React.PointerEvent, b: BlurBox, mode: "move" | "resize") => {
    if (!canEdit || !box.width) return;
    e.preventDefault();
    e.stopPropagation();
    setSel({ kind: "blur", id: b.id });
    beginGesture();
    const x0 = e.clientX, y0 = e.clientY, start = { ...b };
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / box.width, dy = (ev.clientY - y0) / box.height;
      live((cur) => updateBlur(cur, b.id, mode === "move" ? { x: start.x + dx, y: start.y + dy } : { w: start.w + dx, h: start.h + dy }));
    };
    const up = () => { target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", up); };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  };

  // --- Timeline --------------------------------------------------------------------------------
  const [pxPerSec, setPx] = useState(() => Math.max(4, Math.min(80, 900 / Math.max(1, initialEdl.sourceDuration))));
  const width = Math.max(600, total * pxPerSec + 40);
  const tickStep = TICKS.find((s) => s * pxPerSec >= 70) ?? 600;
  const lane = useRef<HTMLDivElement>(null);
  const timeAt = (clientX: number) => {
    const r = lane.current!.getBoundingClientRect();
    return (clientX - r.left) / pxPerSec;
  };
  const scrub = (e: React.PointerEvent) => {
    stop();
    seek(timeAt(e.clientX));
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => seek(timeAt(ev.clientX));
    const up = () => { target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", up); };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  };
  /** Drag a clip edge: the left edge changes where it starts in the recording, the right where it ends. */
  const dragEdge = (e: React.PointerEvent, index: number, edge: "in" | "out") => {
    if (!canEdit) return;
    e.preventDefault();
    e.stopPropagation();
    beginGesture();
    const x0 = e.clientX, c0 = { ...edlRef.current.clips[index]! }, clipStart = clipStarts(edlRef.current)[index]!;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dSrc = ((ev.clientX - x0) / pxPerSec) * c0.speed;
      if (edge === "in") live((cur) => trimClip(cur, index, { srcIn: c0.srcIn + dSrc }));
      else {
        let srcOut = c0.srcOut + dSrc;
        // Snap the end to the playhead when it's within 8 px.
        const endPx = (clipStart + (srcOut - c0.srcIn) / c0.speed) * pxPerSec;
        if (Math.abs(endPx - outRef.current * pxPerSec) < 8) srcOut = c0.srcIn + (outRef.current - clipStart) * c0.speed;
        live((cur) => trimClip(cur, index, { srcOut }));
      }
    };
    const up = () => { target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", up); };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
  };

  const cuesOut = useMemo(() => outputCues(edl, cues), [edl, cues]);
  const caption = captionsOn ? cues.find((c) => here.srcTime >= c.start && here.srcTime < c.end)?.text ?? null : null;
  const activeBlurs = blursAt(edl, here.srcTime);
  const saveLabel = save.state === "error" ? save.message : save.state === "saved" ? "All changes saved" : save.state === "saving" ? "Saving…" : "Unsaved changes";

  return (
    <div className="studio" style={{ display: "grid", gap: 12 }}>
      <div className="callout tip"><b>Studio (beta).</b>&nbsp;Edits here never change the original recording or the Video tab. Studio renders are listed below and labelled as Studio.</div>
      {!canEdit && <div className="callout warn" role="status"><b>Read only.</b>&nbsp;This project is in review, so its edit can&apos;t change right now.</div>}

      <div className="studio-main">
        <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
          <div className="player studio-stage" ref={stage}>
            {/* Captions are drawn by Studio from the script (see below), exactly as the render burns them in. */}
            <video ref={video} src={mediaUrl} preload="auto" playsInline className="studio-video" onLoadedMetadata={() => { measure(); seek(0); }} aria-label="Studio preview" />
            <div className="studio-overlay" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
              {activeBlurs.map((b) => (
                <div key={b.id} className={`studio-blur${selBlur?.id === b.id ? " on" : ""}`} data-testid="preview-blur"
                  style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}
                  onPointerDown={(e) => dragBlur(e, b, "move")} role="button" tabIndex={-1} aria-label="Blur box: drag to move">
                  {canEdit && <span className="studio-handle" onPointerDown={(e) => dragBlur(e, b, "resize")} aria-hidden />}
                </div>
              ))}
              {caption && <span className="studio-caption">{caption}</span>}
            </div>
          </div>

          <div className="row studio-toolbar" role="toolbar" aria-label="Playback and editing">
            <button className="iconbtn" onClick={toggle} aria-label={playing ? "Pause (Space)" : "Play (Space)"} data-testid="studio-play">{playing ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}</button>
            <button className="iconbtn" onClick={() => step(-1)} aria-label="Back one frame (Left arrow)"><ChevronLeft size={16} aria-hidden /></button>
            <button className="iconbtn" onClick={() => step(1)} aria-label="Forward one frame (Right arrow)"><ChevronRight size={16} aria-hidden /></button>
            <span className="meta" style={{ fontVariantNumeric: "tabular-nums" }} data-testid="studio-time">{stamp(outT)} / {stamp(total)}</span>
            <span className="studio-sep" />
            <button className="btn sm" onClick={split} disabled={!canEdit} data-testid="studio-split"><Scissors size={14} aria-hidden /> Split (S)</button>
            <button className="btn sm" onClick={deleteSelected} disabled={!canEdit || !sel || (sel.kind === "clip" && edl.clips.length <= 1)} data-testid="studio-delete"><Trash2 size={14} aria-hidden /> Delete</button>
            <button className="btn sm" onClick={blur} disabled={!canEdit} data-testid="studio-blur"><EyeOff size={14} aria-hidden /> Blur (B)</button>
            <button className="iconbtn" onClick={undo} disabled={!past.length} aria-label="Undo (Ctrl+Z)" data-testid="studio-undo"><Undo2 size={16} aria-hidden /></button>
            <button className="iconbtn" onClick={redo} disabled={!future.length} aria-label="Redo (Ctrl+Shift+Z)"><Redo2 size={16} aria-hidden /></button>
            <span className="spacer" />
            <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={captionsOn} onChange={(e) => setCaptionsOn(e.target.checked)} /> <span className="meta">Captions</span></label>
            <span className="meta" role="status" data-testid="studio-save" style={save.state === "error" ? { color: "var(--error)" } : undefined}>{saveLabel}</span>
          </div>
        </div>

        <aside className="card pad studio-inspector" aria-label="Selected item">
          {selClip >= 0 ? <ClipInspector edl={edl} index={selClip} canEdit={canEdit} apply={apply} />
            : selBlur ? <BlurInspector edl={edl} blur={selBlur} canEdit={canEdit} apply={apply} playheadSrc={here.srcTime} />
            : <Help />}
        </aside>
      </div>

      <div className="card pad" style={{ display: "grid", gap: 8 }}>
        <div className="row between">
          <h2 className="card-h" style={{ margin: 0 }}>Timeline</h2>
          <label className="row" style={{ gap: 6 }}><span className="meta">Zoom</span><input type="range" min={2} max={200} step={1} value={Math.round(pxPerSec)} onChange={(e) => setPx(Number(e.target.value))} aria-label="Timeline zoom" /></label>
        </div>
        <label className="row" style={{ gap: 8 }}><span className="meta">Position</span>
          <input type="range" min={0} max={Math.max(0.1, total)} step={1 / FPS} value={Math.min(outT, total)} onChange={(e) => { stop(); seek(Number(e.target.value)); }} style={{ flex: 1 }} aria-label="Playhead position" aria-valuetext={stamp(outT)} />
        </label>
        <div className="studio-timeline">
          <div className="studio-labels" aria-hidden><span>Time</span><span>Video</span><span>Blur</span><span>Captions</span></div>
          <div className="studio-scroll">
            <div ref={lane} className="studio-lanes" style={{ width }} >
              <div className="studio-ruler" onPointerDown={scrub} data-testid="studio-ruler">
                {Array.from({ length: Math.floor(total / tickStep) + 1 }, (_, k) => <span key={k} className="studio-tick" style={{ left: k * tickStep * pxPerSec }}>{stamp(k * tickStep).replace(/\.0$/, "")}</span>)}
              </div>
              <div className="studio-track" onPointerDown={scrub} role="group" aria-label="Video clips">
                {edl.clips.map((c, i) => (
                  <button key={c.id} type="button" className={`studio-clip${selClip === i ? " on" : ""}`} style={{ left: starts[i]! * pxPerSec, width: Math.max(6, clipLength(c) * pxPerSec) }}
                    onPointerDown={(e) => { e.stopPropagation(); setSel({ kind: "clip", id: c.id }); }} data-testid="studio-clip"
                    aria-label={`Clip ${i + 1}: ${stamp(starts[i]!)} to ${stamp(starts[i]! + clipLength(c))}${c.speed !== 1 ? `, ${c.speed}× speed` : ""}`} aria-pressed={selClip === i}>
                    {canEdit && selClip === i && <span className="studio-edge l" onPointerDown={(e) => dragEdge(e, i, "in")} aria-hidden />}
                    <span className="studio-clip-label">{i + 1}{c.speed !== 1 ? ` · ${c.speed}×` : ""}</span>
                    {canEdit && selClip === i && <span className="studio-edge r" onPointerDown={(e) => dragEdge(e, i, "out")} aria-hidden />}
                  </button>
                ))}
              </div>
              <div className="studio-track" onPointerDown={scrub} role="group" aria-label="Blur boxes">
                {edl.blurs.flatMap((b, k) => toOutput(edl, b.srcStart, b.srcEnd).map((r, j) => (
                  <button key={`${b.id}-${j}`} type="button" className={`studio-blurblock${selBlur?.id === b.id ? " on" : ""}`} style={{ left: r.start * pxPerSec, width: Math.max(6, (r.end - r.start) * pxPerSec) }}
                    onPointerDown={(e) => { e.stopPropagation(); setSel({ kind: "blur", id: b.id }); stop(); seek(r.start); }} aria-label={`Blur ${k + 1}: ${stamp(r.start)} to ${stamp(r.end)}`}>{k + 1}</button>
                )))}
              </div>
              <div className="studio-track" onPointerDown={scrub} aria-hidden>
                {cuesOut.map((c, k) => <span key={k} className="studio-cue" style={{ left: c.start * pxPerSec, width: Math.max(2, (c.end - c.start) * pxPerSec) }} title={c.text} />)}
              </div>
              <div className="studio-playhead" style={{ left: outT * pxPerSec }} aria-hidden />
            </div>
          </div>
        </div>
      </div>

      <StudioRenders projectId={projectId} canRender={canEdit} captions={captionsOn} beforeRender={flush} blocked={save.state === "error"} />
    </div>
  );
}

function ClipInspector({ edl, index, canEdit, apply }: { edl: Edl; index: number; canEdit: boolean; apply: (e: Edl) => void }) {
  const c = edl.clips[index]!;
  const start = clipStarts(edl)[index]!;
  return (
    <div style={{ display: "grid", gap: 10 }} data-testid="clip-inspector">
      <h2 className="card-h" style={{ margin: 0 }}>Clip {index + 1} of {edl.clips.length}</h2>
      <dl className="dl">
        <dt>In the video</dt><dd>{stamp(start)} – {stamp(start + clipLength(c))} ({stamp(clipLength(c))})</dd>
        <dt>From the recording</dt><dd>{stamp(c.srcIn)} – {stamp(c.srcOut)}</dd>
      </dl>
      <label className="f">Speed
        <select className="in" value={c.speed} disabled={!canEdit} onChange={(e) => apply(setSpeed(edl, index, Number(e.target.value)))} data-testid="clip-speed">
          {SPEEDS.map((s) => <option key={s} value={s}>{s}×{s === 1 ? " (normal)" : s > 1 ? " faster" : " slower"}</option>)}
        </select>
      </label>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <button className="btn sm" disabled={!canEdit || index === 0} onClick={() => apply(moveClip(edl, index, index - 1))}>Move earlier</button>
        <button className="btn sm" disabled={!canEdit || index === edl.clips.length - 1} onClick={() => apply(moveClip(edl, index, index + 1))}>Move later</button>
      </div>
      <p className="meta" style={{ margin: 0 }}>Drag the clip&apos;s edges on the timeline to trim it. The right edge snaps to the playhead.</p>
    </div>
  );
}

function BlurInspector({ edl, blur, canEdit, apply, playheadSrc }: { edl: Edl; blur: BlurBox; canEdit: boolean; apply: (e: Edl) => void; playheadSrc: number }) {
  const shown = toOutput(edl, blur.srcStart, blur.srcEnd);
  const n = edl.blurs.findIndex((b) => b.id === blur.id) + 1;
  return (
    <div style={{ display: "grid", gap: 10 }} data-testid="blur-inspector">
      <h2 className="card-h" style={{ margin: 0 }}>Blur {n}</h2>
      <dl className="dl">
        <dt>In the video</dt><dd>{shown.length ? shown.map((r) => `${stamp(r.start)} – ${stamp(r.end)}`).join(", ") : "Cut out (not in the video)"}</dd>
        <dt>Area</dt><dd>{Math.round(blur.w * 100)}% × {Math.round(blur.h * 100)}% of the frame</dd>
      </dl>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <button className="btn sm" disabled={!canEdit} onClick={() => apply(updateBlur(edl, blur.id, { srcStart: playheadSrc }))}>Start at playhead</button>
        <button className="btn sm" disabled={!canEdit} onClick={() => apply(updateBlur(edl, blur.id, { srcEnd: playheadSrc }))}>End at playhead</button>
      </div>
      <p className="meta" style={{ margin: 0 }}>Drag the box on the video to move it, and its corner to resize. The blur follows this content even if you cut or move clips.</p>
    </div>
  );
}

function Help() {
  const keys: [string, string][] = [["Space", "Play or pause"], ["← →", "One frame (Shift: one second)"], ["S", "Split at the playhead"], ["B", "Blur box at the playhead"], ["Delete", "Delete the selected clip or blur"], ["Ctrl+Z / Ctrl+Shift+Z", "Undo / redo"], ["Home / End", "Start / end"]];
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <h2 className="card-h" style={{ margin: 0 }}>Editing</h2>
      <p className="meta" style={{ margin: 0 }}>Select a clip or blur on the timeline to change it. Everything you see in the preview is what the MP4 will contain.</p>
      <dl className="dl">{keys.map(([k, v]) => <div key={k} style={{ display: "contents" }}><dt><kbd>{k}</kbd></dt><dd>{v}</dd></div>)}</dl>
    </div>
  );
}

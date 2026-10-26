"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, ChevronLeft, ChevronRight, CircleDot, EyeOff, Pause, Play, Redo2, Scissors, ScanFace, Square, Sun, Trash2, Type, Undo2 } from "lucide-react";
import {
  addAnnotation, addBlur, annotationsAt, blursAt, clipLength, clipStarts, cutSource, locate, moveClip, outputCues, outputDuration, removeAnnotation, removeBlur, removeClip, setAudio, setSpeed, SPEEDS, splitAt, toOutput, trimClip, updateAnnotation, updateBlur, FPS,
  ANNOTATION_COLORS, type Annotation, type AnnotationColor, type AnnotationKind, type BlurBox, type Cue, type Edl, type Word,
} from "@/lib/studio/edl";
import { byDrawOrder, drawAnnotation, type Ctx } from "@/lib/studio/draw-annotations";
import { saveStudioEdit, startStudioJob, studioStatus } from "@/server/actions/studio";
import { StudioRenders } from "./studio-renders";
import { StudioTranscript } from "./studio-transcript";

type Selection = { kind: "clip"; id: string } | { kind: "blur"; id: string } | { kind: "note"; id: string } | null;
type Job = { kind: string; status: string; detail: string };
const ANNOTATION_LABEL: Record<AnnotationKind, string> = { box: "Box", arrow: "Arrow", text: "Text", badge: "Step number", spotlight: "Spotlight" };
type Save = { state: "saved" | "saving" | "unsaved" } | { state: "error"; message: string };

const newId = (p: string) => `${p}${Math.random().toString(36).slice(2, 10)}`;
/** 75.4 -> "1:15.4" */
export const stamp = (sec: number) => {
  const s = Math.max(0, sec), m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${r < 10 ? "0" : ""}${r.toFixed(1)}`;
};
const TICKS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const LANE_PX = 22;

/** Puts each time range in the first lane where it doesn't overlap anything already there. */
function lanes<T>(groups: { item: T; k: number; ranges: { start: number; end: number }[] }[]) {
  const ends: number[] = [];
  const items = groups.flatMap((g) => g.ranges.map((r, j) => ({ item: g.item, k: g.k, r, j })))
    .sort((a, b) => a.r.start - b.r.start)
    .map((x) => {
      let lane = ends.findIndex((end) => end <= x.r.start + 1e-6);
      if (lane < 0) { lane = ends.length; ends.push(0); }
      ends[lane] = x.r.end;
      return { ...x, lane };
    });
  return { items, count: Math.max(1, ends.length) };
}

export function StudioEditor({ projectId, initialEdl, initialRevision, mediaUrl, cues, canEdit: canEditProject, words, speechAvailable, initialJobs }: {
  projectId: string; initialEdl: Edl; initialRevision: number; mediaUrl: string; cues: Cue[]; canEdit: boolean;
  words: Word[] | null; speechAvailable: boolean; initialJobs: Job[];
}) {
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>(initialJobs);
  const jobOf = (kind: string) => jobs.find((j) => j.kind === kind) ?? null;
  const busy = (kind: string) => ["queued", "running"].includes(jobOf(kind)?.status ?? "");
  // While personal data is being found, the server writes this edit: editing pauses so nothing is lost.
  const canEdit = canEditProject && !busy("pii");
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

  // --- Background jobs (word timings, personal data) ---------------------------------------
  const [jobError, setJobError] = useState<string | null>(null);
  const runJob = useCallback(async (kind: "words" | "pii") => {
    setJobError(null);
    if (kind === "pii") await flush(); // the job edits the saved list, so save first
    const r = await startStudioJob({ projectId, kind });
    if (!r.ok) { setJobError(r.error.message); return; }
    setJobs((js) => [...js.filter((j) => j.kind !== kind), { kind, status: "queued", detail: "Queued" }]);
  }, [flush, projectId]);
  const running = jobs.some((j) => j.status === "queued" || j.status === "running");
  useEffect(() => {
    if (!running) return;
    const t = setTimeout(async () => {
      const r = await studioStatus(projectId);
      if (!r.ok) return;
      const before = jobs;
      setJobs(r.data.jobs);
      const finished = (kind: string) => before.find((j) => j.kind === kind && ["queued", "running"].includes(j.status)) && r.data.jobs.find((j) => j.kind === kind)?.status === "succeeded";
      // Found blur boxes arrive as one undoable change.
      if (finished("pii")) { remember(); edlRef.current = r.data.edl as Edl; setEdlState(r.data.edl as Edl); revision.current = r.data.revision; setSave({ state: "saved" }); }
      if (finished("words")) router.refresh();
    }, 2000);
    return () => clearTimeout(t);
  }, [running, jobs, projectId, remember, router]);

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
  const selNote = sel?.kind === "note" ? edl.annotations.find((a) => a.id === sel.id) ?? null : null;

  const split = useCallback(() => { if (canEdit) apply(splitAt(edlRef.current, outRef.current, newId("c"))); }, [apply, canEdit]);
  const deleteSelected = useCallback(() => {
    if (!canEdit || !sel) return;
    if (sel.kind === "clip") { const i = edlRef.current.clips.findIndex((c) => c.id === sel.id); apply(removeClip(edlRef.current, i)); }
    else if (sel.kind === "blur") apply(removeBlur(edlRef.current, sel.id));
    else apply(removeAnnotation(edlRef.current, sel.id));
    setSel(null);
  }, [apply, canEdit, sel]);
  const [focusText, setFocusText] = useState<string | null>(null); // a new callout: its text field gets focus
  const [inlineEdit, setInlineEdit] = useState<string | null>(null); // a callout being typed into on the video
  const annotate = useCallback((kind: AnnotationKind) => {
    if (!canEdit) return;
    const id = newId("n");
    apply(addAnnotation(edlRef.current, outRef.current, kind, id));
    setSel({ kind: "note", id });
    // So typing goes into the callout, not to the shortcuts (typing "s" would otherwise split the clip).
    if (kind === "text" || kind === "badge") setFocusText(id);
  }, [apply, canEdit]);
  /** Editing by text: cut a stretch of the recording (a little margin so word edges don't click). */
  const cutRange = useCallback((a: number, b: number) => { if (canEdit) apply(cutSource(edlRef.current, Math.max(0, a - 0.04), b + 0.04, () => newId("c"))); }, [apply, canEdit]);
  const tidy = useCallback((cuts: { start: number; end: number }[]) => {
    if (canEdit) apply(cuts.reduce((e, c) => cutSource(e, c.start, c.end, () => newId("c")), edlRef.current)); // one undo step for all of it
  }, [apply, canEdit]);
  const seekSource = useCallback((srcTime: number) => {
    const at = toOutput(edlRef.current, srcTime, srcTime + 0.01)[0];
    if (at) { stop(); seek(at.start); }
  }, [seek, stop]);
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
      if (t.closest("input, textarea, select, [contenteditable='true'], [data-transcript]")) return;
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

  /** Annotations: move or resize the rectangle; for arrows, move either end. */
  const dragNote = (e: React.PointerEvent, a: Annotation, mode: "move" | "resize" | "tail" | "head") => {
    if (!canEdit || !box.width) return;
    e.preventDefault();
    e.stopPropagation();
    setSel({ kind: "note", id: a.id });
    beginGesture();
    const x0 = e.clientX, y0 = e.clientY, s = { ...a };
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / box.width, dy = (ev.clientY - y0) / box.height;
      const patch = mode === "move" ? { x: s.x + dx, y: s.y + dy }
        : mode === "resize" ? { w: s.w + dx, h: s.h + dy }
        : mode === "tail" ? { x: s.x + dx, y: s.y + dy, w: s.w - dx, h: s.h - dy } // the head stays put
        : { w: s.w + dx, h: s.h + dy };
      live((cur) => updateAnnotation(cur, a.id, patch));
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
  // Items that overlap in time get their own lane, so every one stays clickable.
  const blurBlocks = useMemo(() => lanes(edl.blurs.map((b, k) => ({ item: b, k, ranges: toOutput(edl, b.srcStart, b.srcEnd) }))), [edl]);
  const noteBlocks = useMemo(() => lanes(edl.annotations.map((a, k) => ({ item: a, k, ranges: toOutput(edl, a.srcStart, a.srcEnd) }))), [edl]);
  const rows = `24px 44px ${Math.max(30, blurBlocks.count * LANE_PX + 6)}px ${Math.max(30, noteBlocks.count * LANE_PX + 6)}px 18px`;
  const caption = captionsOn ? cues.find((c) => here.srcTime >= c.start && here.srcTime < c.end)?.text ?? null : null;
  const activeBlurs = blursAt(edl, here.srcTime);
  const activeNotes = annotationsAt(edl, here.srcTime);
  const notesCanvas = useRef<HTMLCanvasElement>(null);
  const [frame, setFrame] = useState(0); // bumps when the video shows a new frame after seeking
  /**
   * The preview's picture layer, in the render's order: first each blur box (that part of the current
   * video frame, blurred), then the annotations, drawn with the same code the renderer uses.
   * Blurring is done on a canvas because CSS backdrop blur isn't applied reliably over video.
   */
  useEffect(() => {
    const c = notesCanvas.current, v = video.current;
    if (!c || !v || !box.width) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(box.width * dpr); c.height = Math.round(box.height * dpr);
    const g = c.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, c.width, c.height);
    // Older Safari has no canvas filters (the property is missing, not just empty).
    const canFilter = typeof (g as unknown as { filter?: unknown }).filter === "string";
    if (v.videoWidth && v.readyState >= 2) {
      for (const b of blursAt(edl, here.srcTime)) {
        const dx = b.x * c.width, dy = b.y * c.height, dw = b.w * c.width, dh = b.h * c.height;
        const sx = b.x * v.videoWidth, sy = b.y * v.videoHeight, sw = b.w * v.videoWidth, sh = b.h * v.videoHeight;
        g.save();
        g.beginPath(); g.rect(dx, dy, dw, dh); g.clip();
        if (canFilter) {
          // Strong enough to make text unreadable, and drawn from a wider area than the box (then clipped),
          // so the blur has real pixels at its edges and covers the box completely instead of fading out.
          const px = Math.max(6, Math.min(dw, dh) * 0.5), pad = px * 2.5, k = v.videoWidth / c.width;
          const x0 = Math.max(0, sx - pad * k), y0 = Math.max(0, sy - pad * k);
          const x1 = Math.min(v.videoWidth, sx + sw + pad * k), y1 = Math.min(v.videoHeight, sy + sh + pad * k);
          g.filter = `blur(${px}px)`;
          g.drawImage(v, x0, y0, x1 - x0, y1 - y0, x0 / k, y0 / k, (x1 - x0) / k, (y1 - y0) / k);
        } else {
          // No canvas filters (older browsers): pixelate instead, so the text is still unreadable.
          g.imageSmoothingEnabled = false;
          g.drawImage(v, sx, sy, sw, sh, dx, dy, Math.max(1, dw / 12), Math.max(1, dh / 12));
          g.drawImage(c, dx, dy, Math.max(1, dw / 12), Math.max(1, dh / 12), dx, dy, dw, dh);
        }
        g.restore();
      }
    }
    for (const a of byDrawOrder(annotationsAt(edl, here.srcTime))) drawAnnotation(g as unknown as Ctx, a, c.width, c.height);
  }, [edl, here.srcTime, box.width, box.height, frame]);
  const saveLabel = save.state === "error" ? save.message : save.state === "saved" ? "All changes saved" : save.state === "saving" ? "Saving…" : "Unsaved changes";

  return (
    <div className="studio" style={{ display: "grid", gap: 12 }}>
      <div className="callout tip"><b>Studio (beta).</b>&nbsp;Edits here never change the original recording or the Video tab. Studio renders are listed below and labelled as Studio.</div>
      {!canEdit && <div className="callout warn" role="status"><b>Read only.</b>&nbsp;This project is in review, so its edit can&apos;t change right now.</div>}

      <div className="studio-main">
        <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
          <div className="player studio-stage" ref={stage}>
            {/* Captions are drawn by Studio from the script (see below), exactly as the render burns them in. */}
            <video ref={video} src={mediaUrl} preload="auto" playsInline className="studio-video" onLoadedMetadata={() => { measure(); seek(0); }} onSeeked={() => setFrame((n) => n + 1)} onLoadedData={() => setFrame((n) => n + 1)} aria-label="Studio preview" />
            <div className="studio-overlay" style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
              <canvas ref={notesCanvas} className="studio-notes" aria-hidden data-testid="preview-notes" />
              {activeNotes.map((a) => a.kind === "arrow" ? (
                <span key={a.id}>
                  <span className={`studio-point${selNote?.id === a.id ? " on" : ""}`} style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%` }} onPointerDown={(e) => dragNote(e, a, "tail")} aria-hidden />
                  <span className={`studio-point${selNote?.id === a.id ? " on" : ""}`} style={{ left: `${(a.x + a.w) * 100}%`, top: `${(a.y + a.h) * 100}%` }} onPointerDown={(e) => dragNote(e, a, "head")} aria-hidden />
                </span>
              ) : (
                <div key={a.id} className={`studio-notebox${selNote?.id === a.id ? " on" : ""}`} data-testid="preview-note"
                  style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%`, width: `${a.w * 100}%`, height: `${a.h * 100}%` }}
                  onPointerDown={(e) => { if (inlineEdit !== a.id) dragNote(e, a, "move"); }}
                  onDoubleClick={() => { if (canEdit && (a.kind === "text" || a.kind === "badge")) { beginGesture(); setInlineEdit(a.id); } }}
                  role="button" tabIndex={-1} aria-label={`${ANNOTATION_LABEL[a.kind]}: drag to move${a.kind === "text" || a.kind === "badge" ? ", double-click to type" : ""}`}>
                  {inlineEdit === a.id && (
                    <input className="studio-inline" autoFocus defaultValue={a.text} maxLength={a.kind === "badge" ? 3 : 120} aria-label={`${ANNOTATION_LABEL[a.kind]} text`} data-testid="inline-text"
                      onFocus={(e) => e.currentTarget.select()} onPointerDown={(e) => e.stopPropagation()}
                      onChange={(e) => { const text = e.target.value; live((cur) => updateAnnotation(cur, a.id, { text })); }}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); setInlineEdit(null); } }}
                      onBlur={() => setInlineEdit(null)} />
                  )}
                  {canEdit && <span className="studio-handle" onPointerDown={(e) => dragNote(e, a, "resize")} aria-hidden />}
                </div>
              ))}
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
            <span className="studio-sep" />
            <span className="meta">Add</span>
            <button className="iconbtn" onClick={() => annotate("box")} disabled={!canEdit} aria-label="Add a box" title="Box" data-testid="add-box"><Square size={16} aria-hidden /></button>
            <button className="iconbtn" onClick={() => annotate("arrow")} disabled={!canEdit} aria-label="Add an arrow" title="Arrow" data-testid="add-arrow"><ArrowUpRight size={16} aria-hidden /></button>
            <button className="iconbtn" onClick={() => annotate("text")} disabled={!canEdit} aria-label="Add a text callout" title="Text" data-testid="add-text"><Type size={16} aria-hidden /></button>
            <button className="iconbtn" onClick={() => annotate("badge")} disabled={!canEdit} aria-label="Add a step number" title="Step number" data-testid="add-badge"><CircleDot size={16} aria-hidden /></button>
            <button className="iconbtn" onClick={() => annotate("spotlight")} disabled={!canEdit} aria-label="Add a spotlight" title="Spotlight" data-testid="add-spotlight"><Sun size={16} aria-hidden /></button>
            <span className="studio-sep" />
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
            : selNote ? <NoteInspector edl={edl} note={selNote} canEdit={canEdit} apply={apply} playheadSrc={here.srcTime} focus={focusText === selNote.id} onFocused={() => setFocusText(null)} />
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
          <div className="studio-labels" aria-hidden style={{ gridTemplateRows: rows }}><span>Time</span><span>Video</span><span>Blur</span><span>Notes</span><span>Captions</span></div>
          <div className="studio-scroll">
            <div ref={lane} className="studio-lanes" style={{ width, gridTemplateRows: rows }}>
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
                {blurBlocks.items.map(({ item: b, k, r, j, lane }) => (
                  <button key={`${b.id}-${j}`} type="button" className={`studio-blurblock${selBlur?.id === b.id ? " on" : ""}`}
                    style={{ left: r.start * pxPerSec, width: Math.max(6, (r.end - r.start) * pxPerSec), top: 3 + lane * LANE_PX, height: LANE_PX - 4 }}
                    onPointerDown={(e) => { e.stopPropagation(); setSel({ kind: "blur", id: b.id }); stop(); seek(r.start); }} aria-label={`Blur ${k + 1}${b.label ? ` (${b.label})` : ""}: ${stamp(r.start)} to ${stamp(r.end)}`}>{b.auto ? "A" : k + 1}</button>
                ))}
              </div>
              <div className="studio-track" onPointerDown={scrub} role="group" aria-label="Annotations">
                {noteBlocks.items.map(({ item: a, k, r, j, lane }) => (
                  <button key={`${a.id}-${j}`} type="button" className={`studio-noteblock${selNote?.id === a.id ? " on" : ""}`}
                    style={{ left: r.start * pxPerSec, width: Math.max(6, (r.end - r.start) * pxPerSec), top: 3 + lane * LANE_PX, height: LANE_PX - 4 }}
                    onPointerDown={(e) => { e.stopPropagation(); setSel({ kind: "note", id: a.id }); stop(); seek(r.start); }} aria-label={`${ANNOTATION_LABEL[a.kind]} ${k + 1}: ${stamp(r.start)} to ${stamp(r.end)}`}>{ANNOTATION_LABEL[a.kind]}</button>
                ))}
              </div>
              <div className="studio-track" onPointerDown={scrub} aria-hidden>
                {cuesOut.map((c, k) => <span key={k} className="studio-cue" style={{ left: c.start * pxPerSec, width: Math.max(2, (c.end - c.start) * pxPerSec) }} title={c.text} />)}
              </div>
              <div className="studio-playhead" style={{ left: outT * pxPerSec }} aria-hidden />
            </div>
          </div>
        </div>
      </div>

      <div className="studio-lower">
        <StudioTranscript edl={edl} words={words} playheadSrc={here.srcTime} canEdit={canEdit} job={jobOf("words")} speechAvailable={speechAvailable}
          onPrepare={() => void runJob("words")} onSeek={seekSource} onCut={cutRange} onTidy={tidy} />
        <div style={{ display: "grid", gap: 12, alignContent: "start" }}>
          <div className="card pad" style={{ display: "grid", gap: 8 }} data-testid="studio-pii">
            <h2 className="card-h" style={{ margin: 0 }}>Personal data</h2>
            <p className="meta" style={{ margin: 0 }}>Reads the text on screen and blurs email addresses, phone numbers and the names of people in this workspace. Found boxes are marked “A” on the Blur track: check each one, move or delete it. Running it again replaces only the found boxes.</p>
            <button className="btn primary" style={{ justifySelf: "start" }} disabled={!canEditProject || busy("pii")} onClick={() => void runJob("pii")} data-testid="find-pii">
              <ScanFace size={14} aria-hidden /> {busy("pii") ? jobOf("pii")!.detail : "Find personal data"}
            </button>
            {jobOf("pii") && !busy("pii") && <p className="meta" role="status" style={{ margin: 0 }} data-testid="pii-result">{jobOf("pii")!.detail}</p>}
            {busy("pii") && <p className="meta" style={{ margin: 0 }}>Editing is paused until it finishes.</p>}
          </div>
          <div className="card pad" style={{ display: "grid", gap: 6 }} data-testid="studio-audio">
            <h2 className="card-h" style={{ margin: 0 }}>Audio</h2>
            <label className="check"><input type="checkbox" checked={edl.audio.denoise} disabled={!canEdit} onChange={(e) => apply(setAudio(edl, { denoise: e.target.checked }))} data-testid="audio-denoise" /><span>Reduce background noise<small>Hum, fans, keyboard hiss</small></span></label>
            <label className="check"><input type="checkbox" checked={edl.audio.normalize} disabled={!canEdit} onChange={(e) => apply(setAudio(edl, { normalize: e.target.checked }))} data-testid="audio-normalize" /><span>Even out the volume<small>Same loudness throughout (EBU R128)</small></span></label>
            <p className="meta" style={{ margin: 0 }}>Applied in the render; the preview plays the original sound.</p>
          </div>
          {jobError && <div className="callout warn" role="alert"><b>{jobError}</b></div>}
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
      {blur.auto && <p className="meta" style={{ margin: 0 }} data-testid="auto-blur-label">Found automatically: {blur.label ?? "personal data"}. Check it covers the text, or delete it.</p>}
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

function NoteInspector({ edl, note, canEdit, apply, playheadSrc, focus, onFocused }: { edl: Edl; note: Annotation; canEdit: boolean; apply: (e: Edl) => void; playheadSrc: number; focus: boolean; onFocused: () => void }) {
  const textField = useRef<HTMLInputElement>(null);
  useEffect(() => { if (focus && textField.current) { textField.current.focus(); textField.current.select(); onFocused(); } }, [focus, onFocused]);
  const shown = toOutput(edl, note.srcStart, note.srcEnd);
  return (
    <div style={{ display: "grid", gap: 10 }} data-testid="note-inspector">
      <h2 className="card-h" style={{ margin: 0 }}>{ANNOTATION_LABEL[note.kind]}</h2>
      <dl className="dl"><dt>In the video</dt><dd>{shown.length ? shown.map((r) => `${stamp(r.start)} – ${stamp(r.end)}`).join(", ") : "Cut out (not in the video)"}</dd></dl>
      {(note.kind === "text" || note.kind === "badge") && (
        <label className="f">{note.kind === "badge" ? "Number" : "Text"}
          <input ref={textField} type="text" maxLength={note.kind === "badge" ? 3 : 120} value={note.text} disabled={!canEdit} onChange={(e) => apply(updateAnnotation(edl, note.id, { text: e.target.value }))} data-testid="note-text" />
        </label>
      )}
      <label className="f">Colour
        <select className="in" value={note.color} disabled={!canEdit} onChange={(e) => apply(updateAnnotation(edl, note.id, { color: e.target.value as AnnotationColor }))}>
          {(Object.keys(ANNOTATION_COLORS) as AnnotationColor[]).map((c) => <option key={c} value={c}>{c[0]!.toUpperCase() + c.slice(1)}</option>)}
        </select>
      </label>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <button className="btn sm" disabled={!canEdit} onClick={() => apply(updateAnnotation(edl, note.id, { srcStart: playheadSrc }))}>Start at playhead</button>
        <button className="btn sm" disabled={!canEdit} onClick={() => apply(updateAnnotation(edl, note.id, { srcEnd: playheadSrc }))}>End at playhead</button>
      </div>
      <p className="meta" style={{ margin: 0 }}>{note.kind === "arrow" ? "Drag either end of the arrow on the video." : `Drag it on the video to move it, and its corner to resize.${note.kind === "text" || note.kind === "badge" ? " Double-click it to type on the video." : ""}`}</p>
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

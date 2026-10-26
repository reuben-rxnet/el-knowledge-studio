"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Scissors, X } from "lucide-react";
import type { UploadMeta } from "@/components/content/creation-wizard";

type Mode = "whole" | "trim" | "split";
const MIN_PART = 5;
const MAX_PARTS = 20;

/** "1:02:03", "12:30", "90" -> seconds; null when it isn't a time. */
export function parseTime(s: string): number | null {
  const t = s.trim();
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(t)) return null;
  return t.split(":").map(Number).reduce((acc, n) => acc * 60 + n, 0);
}
export const clock = (sec: number) => {
  const s = Math.max(0, Math.round(sec)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
};

/**
 * Optional step after a video or audio upload: keep the whole file, trim it, or split it into parts
 * (each part becomes its own project). The browser only picks the times; the server cuts the file.
 */
export function TrimSplit({ file, kind, upload, onApplied, onPending }: {
  file: File; kind: "video" | "audio"; upload: UploadMeta; onApplied: (parts: UploadMeta[]) => void;
  /** True while a trim or split is chosen but not yet applied (the panel holds Continue). */
  onPending: (pending: boolean) => void;
}) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const player = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [length, setLength] = useState(upload.durationSec ?? 0); // 0 = unknown (some WEBM recordings)
  const [mode, setMode] = useState<Mode>("whole");
  const [start, setStart] = useState("0:00");
  const [end, setEnd] = useState(length ? clock(length) : "");
  const [every, setEvery] = useState("10");
  const [points, setPoints] = useState<number[]>([]);
  const [at, setAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const now = () => player.current?.currentTime ?? 0;

  // The part boundaries the server will cut.
  const cuts = useMemo((): { startSec: number; endSec: number }[] | string => {
    if (mode === "trim") {
      const a = parseTime(start), b = parseTime(end);
      if (a === null || b === null) return "Enter the start and end as minutes:seconds, for example 1:30.";
      if (b - a < MIN_PART) return `The trimmed part must be at least ${MIN_PART} seconds long.`;
      if (length && a >= length) return "The start is after the end of the file.";
      return [{ startSec: a, endSec: length ? Math.min(b, length) : b }];
    }
    if (mode === "split") {
      const inner = [...new Set(points.map((p) => Math.round(p)))].filter((p) => p > 0 && (!length || p < length)).sort((a, b) => a - b);
      if (!inner.length) return "Add at least one split point.";
      const edges = [0, ...inner, length || 10_000_000];
      const parts = edges.slice(0, -1).map((s, i) => ({ startSec: s, endSec: edges[i + 1]! }));
      if (parts.length > MAX_PARTS) return `At most ${MAX_PARTS} parts.`;
      if (parts.some((p) => p.endSec - p.startSec < MIN_PART)) return `Every part must be at least ${MIN_PART} seconds long.`;
      return parts;
    }
    return [];
  }, [mode, start, end, points, length]);

  function fillEvery() {
    const min = Number(every);
    if (!length || !(min > 0)) return;
    const pts: number[] = [];
    for (let t = min * 60; t < length - MIN_PART && pts.length < MAX_PARTS - 1; t += min * 60) pts.push(t);
    setPoints(pts);
  }

  async function apply() {
    if (typeof cuts === "string" || !cuts.length) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/uploads/edit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ storageKey: upload.storageKey, fileName: upload.fileName, mimeType: upload.mimeType, cuts }) });
      const json = (await res.json()) as { parts?: UploadMeta[]; message?: string };
      if (!res.ok || !json.parts) throw new Error(json.message ?? "The file couldn't be cut. Try again.");
      onApplied(json.parts);
      onPending(false);
      setDone(json.parts.length === 1 ? `Trimmed to ${clock(json.parts[0]!.durationSec ?? 0)}.` : `Split into ${json.parts.length} parts. Each becomes its own project.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The file couldn't be cut.");
    } finally {
      setBusy(false);
    }
  }

  function choose(m: Mode) {
    setMode(m); setError(null); setDone(null);
    onPending(m !== "whole");
    if (m === "whole") onApplied([upload]);
  }

  return (
    <div className="card pad" style={{ boxShadow: "none", display: "grid", gap: 10 }} data-testid="trim-split">
      <div className="row" style={{ gap: 8 }}><Scissors size={16} aria-hidden /><h3 className="card-h" style={{ margin: 0 }}>Trim or split (optional)</h3></div>
      <div className="row" role="radiogroup" aria-label="Use of the file" style={{ gap: 6, flexWrap: "wrap" }}>
        {(["whole", "trim", "split"] as Mode[]).map((m) => (
          <button key={m} type="button" className="chip" role="radio" aria-checked={mode === m} onClick={() => choose(m)}>
            {m === "whole" ? "Use the whole file" : m === "trim" ? "Trim" : "Split into parts"}
          </button>
        ))}
      </div>
      {mode !== "whole" && <>
        {kind === "video"
          ? <video ref={player} src={url} controls preload="metadata" style={{ width: "100%", maxHeight: 280, background: "#000", borderRadius: 8 }} onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d) && !length) { setLength(Math.round(d)); setEnd(clock(d)); } }} aria-label="Preview to pick positions" />
          : <audio ref={player} src={url} controls preload="metadata" style={{ width: "100%" }} onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d) && !length) { setLength(Math.round(d)); setEnd(clock(d)); } }} aria-label="Preview to pick positions" />}
        <p className="meta" style={{ margin: 0 }}>Length {length ? clock(length) : "unknown until the file is played"}. Cuts land on the nearest keyframe, usually within a second or two.</p>
      </>}
      {mode === "trim" && (
        <div className="grid g2">
          <label className="f">Start
            <span className="row" style={{ gap: 6 }}><input type="text" inputMode="numeric" value={start} onChange={(e) => setStart(e.target.value)} aria-describedby="time-hint" /><button type="button" className="btn sm" onClick={() => setStart(clock(now()))}>Use current position</button></span>
          </label>
          <label className="f">End
            <span className="row" style={{ gap: 6 }}><input type="text" inputMode="numeric" value={end} onChange={(e) => setEnd(e.target.value)} aria-describedby="time-hint" /><button type="button" className="btn sm" onClick={() => setEnd(clock(now()))}>Use current position</button></span>
          </label>
        </div>
      )}
      {mode === "split" && (
        <div style={{ display: "grid", gap: 8 }}>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <label className="row" style={{ gap: 6 }}><span>Split every</span><input type="number" min={1} style={{ width: 80 }} value={every} onChange={(e) => setEvery(e.target.value)} aria-label="Minutes per part" /><span>minutes</span></label>
            <button type="button" className="btn sm" disabled={!length} onClick={fillEvery} title={length ? undefined : "Play the file once so its length is known"}>Make parts</button>
            <button type="button" className="btn sm" onClick={() => setPoints((p) => [...p, now()])}>Add a split at the current position</button>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <label className="row" style={{ gap: 6 }}><span>Split at</span><input type="text" inputMode="numeric" style={{ width: 90 }} placeholder="12:30" value={at} onChange={(e) => setAt(e.target.value)} aria-describedby="time-hint" /></label>
            <button type="button" className="btn sm" disabled={parseTime(at) === null} onClick={() => { const t = parseTime(at); if (t !== null) { setPoints((p) => [...p, t]); setAt(""); } }}>Add split</button>
          </div>
          {points.length > 0 && <div className="row" style={{ gap: 6, flexWrap: "wrap" }} aria-label="Split points">
            {[...points].sort((a, b) => a - b).map((p) => <span key={p} className="chip">{clock(p)}<button type="button" className="iconbtn" style={{ width: 22, height: 22 }} aria-label={`Remove split at ${clock(p)}`} onClick={() => setPoints((x) => x.filter((y) => y !== p))}><X size={12} aria-hidden /></button></span>)}
          </div>}
          {Array.isArray(cuts) && cuts.length > 0 && <p className="meta" style={{ margin: 0 }}>{cuts.length} parts: {cuts.map((c) => `${clock(c.startSec)}–${c.endSec >= 10_000_000 ? "end" : clock(c.endSec)}`).join(", ")}</p>}
        </div>
      )}
      {mode !== "whole" && <>
        <span id="time-hint" className="sr">Times as minutes:seconds or hours:minutes:seconds</span>
        {typeof cuts === "string" && <p className="meta" style={{ margin: 0 }}>{cuts}</p>}
        {error && <div className="callout warn" role="alert"><b>{error}</b></div>}
        {done && <div className="callout tip" role="status"><b>{done}</b></div>}
        <button type="button" className="btn primary" style={{ justifySelf: "start" }} disabled={busy || typeof cuts === "string"} onClick={apply} data-testid="apply-cut">
          <Scissors size={16} aria-hidden /> {busy ? "Cutting…" : mode === "trim" ? "Trim the file" : "Split the file"}
        </button>
      </>}
    </div>
  );
}

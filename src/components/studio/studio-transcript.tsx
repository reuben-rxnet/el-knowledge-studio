"use client";
import { useMemo, useState } from "react";
import { Scissors, Sparkles } from "lucide-react";
import { isFiller, isShown, tidyCuts, type Edl, type Word } from "@/lib/studio/edl";

/**
 * Edit by text: the recording's words in order. Deleting words cuts that stretch of the video.
 * Words that are no longer in the video stay visible, struck through, so nothing disappears silently.
 */
export function StudioTranscript({ edl, words, playheadSrc, canEdit, job, speechAvailable, onPrepare, onSeek, onCut, onTidy }: {
  edl: Edl; words: Word[] | null; playheadSrc: number; canEdit: boolean;
  job: { status: string; detail: string } | null; speechAvailable: boolean;
  onPrepare: () => void; onSeek: (srcTime: number) => void;
  onCut: (srcStart: number, srcEnd: number) => void;
  onTidy: (cuts: { start: number; end: number }[]) => void;
}) {
  const [sel, setSel] = useState<[number, number] | null>(null);
  const [fillers, setFillers] = useState(true);
  const [pauses, setPauses] = useState(true);
  const [pauseSec, setPauseSec] = useState("1.0");
  const running = job?.status === "queued" || job?.status === "running";
  const pause = Number(pauseSec);
  const cuts = useMemo(() => (words ? tidyCuts(edl, words, { fillers, pauseSec: pauses && pause > 0 ? pause : null }) : []), [edl, words, fillers, pauses, pause]);
  const saved = cuts.reduce((t, c) => t + (c.end - c.start), 0);

  if (!words) {
    return (
      <div className="card pad" style={{ display: "grid", gap: 8 }} data-testid="studio-transcript">
        <h2 className="card-h" style={{ margin: 0 }}>Edit by text</h2>
        <p className="meta" style={{ margin: 0 }}>Delete words to cut the video, and remove filler words and long pauses in one go. This needs the time of every spoken word, worked out on this server with Whisper.</p>
        {job?.status === "failed" && <div className="callout warn" role="alert"><b>{job.detail}</b></div>}
        <button className="btn primary" style={{ justifySelf: "start" }} disabled={!canEdit || running || !speechAvailable} onClick={onPrepare} data-testid="prepare-words">
          <Sparkles size={14} aria-hidden /> {running ? job!.detail : "Prepare text editing"}
        </button>
        {!speechAvailable && <p className="meta" style={{ margin: 0 }}>Speech recognition is switched off on this server.</p>}
      </div>
    );
  }

  const [a, b] = sel ? [Math.min(...sel), Math.max(...sel)] : [-1, -1];
  const cutSelection = () => { if (sel && canEdit) { onCut(words[a]!.start, words[b]!.end); setSel(null); } };
  // A new paragraph after a pause of 1.5 s or more, so the text reads like the speech.
  const paragraphs: number[][] = [];
  words.forEach((w, i) => { if (!i || w.start - words[i - 1]!.end >= 1.5) paragraphs.push([]); paragraphs.at(-1)!.push(i); });

  return (
    <div className="card pad" style={{ display: "grid", gap: 10 }} data-testid="studio-transcript">
      <div className="row between">
        <h2 className="card-h" style={{ margin: 0 }}>Edit by text</h2>
        <button className="btn sm" disabled={!canEdit || !sel} onClick={cutSelection} data-testid="cut-words"><Scissors size={14} aria-hidden /> {sel ? `Cut ${b - a + 1} word${b > a ? "s" : ""}` : "Cut selected words"}</button>
      </div>
      <p className="meta" style={{ margin: 0 }}>Click a word to jump to it; Shift-click to select a stretch, then press Delete or Cut. Struck-through words are cut from the video. Undo brings them back.</p>
      {words.length === 0 ? <p className="meta">No speech was found in the recording.</p> : (
        <div className="studio-words" tabIndex={0} data-transcript role="listbox" aria-label="Transcript words" aria-multiselectable
          onKeyDown={(e) => { if ((e.key === "Delete" || e.key === "Backspace") && sel) { e.preventDefault(); e.stopPropagation(); cutSelection(); } else if (e.key === "Escape") setSel(null); }}>
          {paragraphs.map((p, k) => (
            <p key={k}>{p.map((i) => {
              const w = words[i]!, shown = isShown(edl, (w.start + w.end) / 2), on = i >= a && i <= b, now = playheadSrc >= w.start && playheadSrc < w.end;
              return (
                <span key={i} role="option" aria-selected={on} data-testid="word"
                  className={`studio-word${shown ? "" : " cut"}${on ? " sel" : ""}${now ? " now" : ""}${isFiller(w) ? " filler" : ""}`}
                  onClick={(e) => { if (e.shiftKey && sel) setSel([sel[0], i]); else { setSel([i, i]); if (shown) onSeek(w.start); } }}>
                  {w.text}{" "}
                </span>
              );
            })}</p>
          ))}
        </div>
      )}
      <div className="studio-tidy">
        <b>Tidy up</b>
        <label className="check"><input type="checkbox" checked={fillers} onChange={(e) => setFillers(e.target.checked)} /><span>Remove filler words<small>um, uh, er, hmm…</small></span></label>
        <label className="check"><input type="checkbox" checked={pauses} onChange={(e) => setPauses(e.target.checked)} />
          <span>Shorten pauses longer than <input type="number" min={0.3} step={0.1} style={{ width: 64 }} value={pauseSec} onChange={(e) => setPauseSec(e.target.value)} aria-label="Pause length in seconds" /> seconds<small>A short gap is kept so speech doesn&apos;t run together.</small></span>
        </label>
        <button className="btn sm" disabled={!canEdit || !cuts.length} onClick={() => onTidy(cuts)} data-testid="apply-tidy">
          {cuts.length ? `Apply: ${cuts.filter((c) => c.kind === "filler").length} fillers, ${cuts.filter((c) => c.kind === "pause").length} pauses (saves ${saved.toFixed(1)} s)` : "Nothing to tidy"}
        </button>
      </div>
    </div>
  );
}

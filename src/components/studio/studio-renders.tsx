"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { Download, Film } from "lucide-react";
import { startStudioRender } from "@/server/actions/studio";
import { useToast } from "@/components/common/toast";
import { OfficialRenderButton } from "@/components/editor/official-render-button";
import { mmss } from "@/lib/utilities/format";

interface Render {
  id: string; status: string; detail: string; version: number; durationSec: number | null; sizeBytes: number | null; createdAt: string;
  official: boolean; choosable: boolean; chapters: { start: number; end: number; title: string }[]; captionLanguages: string[];
}

/** Studio's own renders (labelled as Studio). The Video tab's renders are listed there, not here. */
export function StudioRenders({ projectId, canRender, captions, beforeRender, blocked }: {
  projectId: string; canRender: boolean; captions: boolean; beforeRender: () => Promise<void>; blocked: boolean;
}) {
  const toast = useToast();
  const [renders, setRenders] = useState<Render[]>([]);
  const [canChoose, setCanChoose] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [tick, setTick] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const running = renders.some((r) => r.status === "queued" || r.status === "running");
  const latest = renders.find((r) => r.status === "succeeded");

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let live = true;
    const load = async () => {
      const res = await fetch(`/api/projects/${projectId}/render?engine=studio`, { cache: "no-store" }).catch(() => null);
      if (!live || !res?.ok) return;
      const body = (await res.json()) as { renders: Render[]; canChoose: boolean };
      setRenders(body.renders);
      setCanChoose(body.canChoose);
      if (body.renders.some((r) => r.status === "queued" || r.status === "running")) timer = setTimeout(load, 2000);
    };
    void load();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [projectId, tick]);

  function render() {
    start(async () => {
      await beforeRender(); // the render uses the saved edit, so save first
      const r = await startStudioRender({ projectId, captions });
      if (!r.ok) { setError(r.error.message); return; }
      setError(null);
      toast("Studio render started. It appears below when it's ready.");
      setTick((t) => t + 1);
    });
  }

  const seek = (t: number) => { const v = video.current; if (!v) return; v.currentTime = t; void v.play().catch(() => {}); };
  const file = (id: string) => `/api/projects/${projectId}/render?file=${id}`;

  return (
    <div className="card pad" style={{ display: "grid", gap: 10 }}>
      <div className="row between">
        <h2 className="card-h" style={{ margin: 0 }}><Film size={16} aria-hidden /> Studio renders</h2>
        <button className="btn primary" disabled={!canRender || running || pending || blocked} onClick={render} data-testid="studio-render">{running ? "Rendering…" : pending ? "Starting…" : "Render this edit"}</button>
      </div>
      <p className="meta" style={{ margin: 0 }}>Renders exactly what the preview shows: the clips in order, their speeds, the blur boxes{captions ? " and the captions" : ""}. Rendered on this server with FFmpeg.</p>
      {error && <div className="callout warn" role="alert"><b>{error}</b></div>}
      {renders.length > 0 && (
        <ul className="list">{renders.map((r) => (
          <li key={r.id} data-testid="studio-render-row">
            <div style={{ flex: 1 }}>
              <div className="t">v{r.version} · Rendered in Studio</div>
              <div className="meta">{r.status === "succeeded" ? `${r.durationSec ?? "?"} s · ${((r.sizeBytes ?? 0) / 1048576).toFixed(1)} MB` : r.detail}</div>
              {r.status === "succeeded" && r.captionLanguages.length > 0 && (
                <div className="meta" data-testid="studio-subtitles">Subtitles:{" "}
                  {r.captionLanguages.map((l, i) => <span key={l}>{i > 0 && " · "}<a className="link" href={`${file(r.id)}&vtt=${encodeURIComponent(l)}&download=1`} title={`Download the ${l.toUpperCase()} subtitles (WebVTT)`}>{l.toUpperCase()}</a></span>)}
                </div>
              )}
            </div>
            {r.status === "succeeded" ? (
              <div className="row" style={{ gap: 6 }}>
                {canChoose && (r.choosable || r.official) ? <OfficialRenderButton projectId={projectId} renderId={r.id} official={r.official} onChanged={() => setTick((t) => t + 1)} />
                  : r.official ? <span className="pill s-ok">Chosen for publishing</span> : null}
                <a className="btn sm" href={`${file(r.id)}&download=1`}><Download size={14} aria-hidden /> MP4</a>
              </div>
            ) : <span className={`pill ${r.status === "failed" ? "s-err" : "s-info"}`}>{r.status === "failed" ? "Failed" : "Rendering"}</span>}
          </li>
        ))}</ul>
      )}
      {latest && <video ref={video} key={latest.id} className="player" style={{ width: "100%" }} controls preload="metadata" src={file(latest.id)} aria-label="Latest Studio render" data-testid="studio-rendered">
        {latest.captionLanguages.map((l) => <track key={l} kind="subtitles" srcLang={l} label={l.toUpperCase()} src={`${file(latest.id)}&vtt=${encodeURIComponent(l)}`} />)}
      </video>}
      {latest && latest.chapters.length > 0 && (
        <div data-testid="studio-render-chapters">
          <div className="meta">Chapters in this video</div>
          <ul className="list" style={{ margin: 0 }}>{latest.chapters.map((c) => (
            <li key={`${c.start}-${c.title}`} style={{ padding: "4px 0" }}>
              <button type="button" className="btn sm" onClick={() => seek(c.start)} aria-label={`Play from ${mmss(c.start)}: ${c.title}`}>{mmss(c.start)}</button>
              <span style={{ flex: 1 }}>{c.title}</span>
            </li>
          ))}</ul>
        </div>
      )}
    </div>
  );
}

"use client";
import { useEffect, useState, useTransition } from "react";
import { Download, Film } from "lucide-react";
import { startStudioRender } from "@/server/actions/studio";
import { useToast } from "@/components/common/toast";

interface Render { id: string; status: string; detail: string; version: number; durationSec: number | null; sizeBytes: number | null; createdAt: string }

/** Studio's own renders (labelled as Studio). The Video tab's renders are listed there, not here. */
export function StudioRenders({ projectId, canRender, captions, beforeRender, blocked }: {
  projectId: string; canRender: boolean; captions: boolean; beforeRender: () => Promise<void>; blocked: boolean;
}) {
  const toast = useToast();
  const [renders, setRenders] = useState<Render[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [tick, setTick] = useState(0);
  const running = renders.some((r) => r.status === "queued" || r.status === "running");
  const latest = renders.find((r) => r.status === "succeeded");

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let live = true;
    const load = async () => {
      const res = await fetch(`/api/projects/${projectId}/render?engine=studio`, { cache: "no-store" }).catch(() => null);
      if (!live || !res?.ok) return;
      const body = (await res.json()) as { renders: Render[] };
      setRenders(body.renders);
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
          <li key={r.id}>
            <div style={{ flex: 1 }}><div className="t">v{r.version} · Rendered in Studio</div><div className="meta">{r.status === "succeeded" ? `${r.durationSec ?? "?"} s · ${((r.sizeBytes ?? 0) / 1048576).toFixed(1)} MB` : r.detail}</div></div>
            {r.status === "succeeded" ? <a className="btn sm" href={`/api/projects/${projectId}/render?file=${r.id}&download=1`}><Download size={14} aria-hidden /> MP4</a>
              : <span className={`pill ${r.status === "failed" ? "s-err" : "s-info"}`}>{r.status === "failed" ? "Failed" : "Rendering"}</span>}
          </li>
        ))}</ul>
      )}
      {latest && <video key={latest.id} className="player" style={{ width: "100%" }} controls preload="metadata" src={`/api/projects/${projectId}/render?file=${latest.id}`} aria-label="Latest Studio render" data-testid="studio-rendered" />}
    </div>
  );
}

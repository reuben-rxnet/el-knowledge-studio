"use client";
import { useEffect, useState, useTransition } from "react";
import { Clapperboard, Download } from "lucide-react";
import { startRender } from "@/server/actions/render";
import { TonePill } from "@/components/common/badges";
import { OfficialRenderButton } from "./official-render-button";
import { useToast } from "@/components/common/toast";

interface Render { id: string; status: string; detail: string; language: string; aiVoice: boolean; version: number; durationSec: number | null; sizeBytes: number | null; official: boolean; choosable: boolean }

/** Render a finished MP4 on the server (FFmpeg + optional open-source AI voice), then watch or download it. */
export function RenderPanel({ projectId, languages, voices, voiceLanguages, canRender, hasRecording }: {
  projectId: string; languages: { code: string; label: string }[]; voices: { id: string; label: string }[]; voiceLanguages: string[]; canRender: boolean; hasRecording: boolean;
}) {
  const toast = useToast();
  const [renders, setRenders] = useState<Render[]>([]);
  const [lang, setLang] = useState(languages[0]?.code ?? "en");
  const [aiVoice, setAiVoice] = useState(!hasRecording);
  const [voice, setVoice] = useState(voices[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [tick, setTick] = useState(0);
  const [canChoose, setCanChoose] = useState(false);
  const voiceOk = voiceLanguages.includes(lang);
  const running = renders.some((r) => r.status === "queued" || r.status === "running");
  const latest = renders.find((r) => r.status === "succeeded");

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      const res = await fetch(`/api/projects/${projectId}/render`, { cache: "no-store" }).catch(() => null);
      if (res?.ok && !stop) {
        const body = (await res.json()) as { renders: Render[]; canChoose: boolean };
        setRenders(body.renders);
        setCanChoose(body.canChoose);
        if (body.renders.some((r) => r.status === "queued" || r.status === "running")) timer = setTimeout(load, 2000);
      }
    };
    void load();
    return () => { stop = true; clearTimeout(timer); };
  }, [projectId, tick]);

  return (
    <div className="card pad" style={{ display: "grid", gap: 10 }}>
      <div className="row between"><h2 className="card-h"><Clapperboard size={16} aria-hidden /> Rendered video</h2>{latest && <TonePill tone="ok">MP4 ready</TonePill>}</div>
      <p className="meta" style={{ margin: 0 }}>
        {hasRecording ? "Your recording with captions burned in and redacted scenes blurred. Optionally replace the original audio with an AI voice." : "A title card and a narrated slide for each chapter, with a captions track."}
        {" "}Rendered on this server with open-source FFmpeg. The AI voice (Kokoro, English) also runs here, so no content leaves the server.
      </p>
      {canRender && (
        <div className="row" style={{ gap: 10 }}>
          <label className="row" style={{ gap: 6 }}><span className="meta">Language</span>
            <select className="in" style={{ width: "auto" }} value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Video language">{languages.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}</select>
          </label>
          <label className="row" style={{ gap: 6 }} title={voiceOk ? undefined : "The AI voice speaks English only"}>
            <input type="checkbox" checked={aiVoice && voiceOk} disabled={!voiceOk} onChange={(e) => setAiVoice(e.target.checked)} /> <span className="meta">{hasRecording ? "Replace audio with AI voice" : "AI voice narration"}{voiceOk ? "" : " (English only)"}</span>
          </label>
          {aiVoice && voiceOk && (
            <select className="in" style={{ width: "auto" }} value={voice} onChange={(e) => setVoice(e.target.value)} aria-label="AI voice">{voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select>
          )}
          <button className="btn primary" disabled={pending || running} onClick={() => start(async () => {
            const r = await startRender({ projectId, language: lang, aiVoice: aiVoice && voiceOk, voice: aiVoice && voiceOk ? voice : undefined });
            if (!r.ok) { setError(r.error.message); return; }
            setError(null); toast("Rendering started. It takes about a minute per minute of video with the AI voice."); setTick((t) => t + 1);
          })} data-testid="render-video">{running ? "Rendering…" : "Render video"}</button>
        </div>
      )}
      {error && <div className="callout warn" role="alert"><b>{error}</b></div>}
      {renders.length > 0 && (
        <ul className="list" style={{ margin: 0 }}>
          {renders.map((r) => (
            <li key={r.id} style={{ padding: "8px 0" }}>
              <div style={{ flex: 1 }}>
                <span className="t">v{r.version} · {r.language.toUpperCase()}{r.aiVoice ? " · AI voice" : ""}</span>
                <span className="meta" style={{ display: "block" }} aria-live="polite">{r.status === "succeeded" ? `${r.durationSec ?? "?"} s · ${((r.sizeBytes ?? 0) / 1048576).toFixed(1)} MB` : r.detail}</span>
              </div>
              {r.status === "succeeded" ? <div className="row" style={{ gap: 6 }}>
                {canChoose && (r.choosable || r.official) ? <OfficialRenderButton projectId={projectId} renderId={r.id} official={r.official} onChanged={() => setTick((t) => t + 1)} /> : r.official ? <TonePill tone="ok">Chosen for publishing</TonePill> : null}
                <a className="btn sm" href={`/api/projects/${projectId}/render?file=${r.id}&download=1`}><Download size={14} aria-hidden /> MP4</a>
              </div>
                : <TonePill tone={r.status === "failed" ? "err" : "info"}>{r.status === "failed" ? "Failed" : "Rendering"}</TonePill>}
            </li>
          ))}
        </ul>
      )}
      {latest && <video key={latest.id} className="player" style={{ width: "100%" }} controls preload="metadata" src={`/api/projects/${projectId}/render?file=${latest.id}`} aria-label="Rendered video" data-testid="rendered-video" />}
    </div>
  );
}

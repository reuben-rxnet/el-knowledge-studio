"use client";
// Studio's side panels for phase 3: zoom, output shape, brand, music, voice and captions, and the
// inspectors for a selected zoom or chapter. Each changes the edit list through `apply` (undoable).
import { useEffect, useRef, useState } from "react";
import { Bookmark, Clapperboard, Music, Pause, Play, ZoomIn } from "lucide-react";
import { ASPECTS, removeChapter, setChapters, setOptions, toOutput, updateChapter, updateZoom, ZOOM_SCALES, type Aspect, type Chapter, type Edl, type Zoom } from "@/lib/studio/edl";
import { drawCard, logoSvg, type BrandCtx, type LogoImage } from "@/lib/studio/draw-brand";
import type { BrandTemplate } from "@/lib/studio/brand-template";
import type { MusicTrack } from "@/lib/studio/music";

type Apply = (e: Edl) => void;
const stamp = (sec: number) => { const s = Math.max(0, sec), m = Math.floor(s / 60), r = s - m * 60; return `${m}:${r < 10 ? "0" : ""}${r.toFixed(1)}`; };
const newId = (p: string) => `${p}${Math.random().toString(36).slice(2, 10)}`;
const ASPECT_LABEL: Record<Aspect, string> = { "16:9": "16:9 · landscape (default)", "1:1": "1:1 · square", "9:16": "9:16 · vertical (mobile)" };

export function ZoomInspector({ edl, zoom, canEdit, apply, playheadSrc }: { edl: Edl; zoom: Zoom; canEdit: boolean; apply: Apply; playheadSrc: number }) {
  const shown = toOutput(edl, zoom.srcStart, zoom.srcEnd);
  return (
    <div style={{ display: "grid", gap: 10 }} data-testid="zoom-inspector">
      <h2 className="card-h" style={{ margin: 0 }}><ZoomIn size={16} aria-hidden /> Zoom</h2>
      {zoom.auto && <p className="meta" style={{ margin: 0 }} data-testid="auto-zoom-label">Found automatically where the screen changed. Check it frames the right place, or delete it.</p>}
      <dl className="dl"><dt>In the video</dt><dd>{shown.length ? shown.map((r) => `${stamp(r.start)} – ${stamp(r.end)}`).join(", ") : "Cut out (not in the video)"}</dd></dl>
      <label className="f">Zoom level
        <select className="in" value={ZOOM_SCALES.includes(zoom.scale as (typeof ZOOM_SCALES)[number]) ? zoom.scale : ""} disabled={!canEdit} onChange={(e) => apply(updateZoom(edl, zoom.id, { scale: Number(e.target.value) }))} data-testid="zoom-scale">
          {!ZOOM_SCALES.includes(zoom.scale as (typeof ZOOM_SCALES)[number]) && <option value="">{zoom.scale}×</option>}
          {ZOOM_SCALES.map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
      </label>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <button className="btn sm" disabled={!canEdit} onClick={() => apply(updateZoom(edl, zoom.id, { srcStart: playheadSrc }))}>Start at playhead</button>
        <button className="btn sm" disabled={!canEdit} onClick={() => apply(updateZoom(edl, zoom.id, { srcEnd: playheadSrc }))}>End at playhead</button>
      </div>
      <p className="meta" style={{ margin: 0 }}>While a zoom is selected the preview shows the whole screen with the zoomed area outlined: drag the outline to aim it, and its corner to zoom further in or out. Press Play to watch the zoom.</p>
    </div>
  );
}

export function ChapterInspector({ edl, chapter, canEdit, apply, playheadSrc }: { edl: Edl; chapter: Chapter; canEdit: boolean; apply: Apply; playheadSrc: number }) {
  const at = toOutput(edl, chapter.srcTime, chapter.srcTime + 0.01)[0];
  return (
    <div style={{ display: "grid", gap: 10 }} data-testid="chapter-inspector">
      <h2 className="card-h" style={{ margin: 0 }}><Bookmark size={16} aria-hidden /> Chapter</h2>
      <dl className="dl"><dt>Starts at</dt><dd>{at ? stamp(at.start) : "Cut out (not in the video)"}</dd></dl>
      <label className="f">Title
        <input type="text" maxLength={80} value={chapter.title} disabled={!canEdit} onChange={(e) => apply(updateChapter(edl, chapter.id, { title: e.target.value }))} data-testid="chapter-title" />
      </label>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <button className="btn sm" disabled={!canEdit} onClick={() => apply(updateChapter(edl, chapter.id, { srcTime: playheadSrc }))}>Move to playhead</button>
        <button className="btn sm" disabled={!canEdit} onClick={() => apply(removeChapter(edl, chapter.id))}>Delete</button>
      </div>
      <p className="meta" style={{ margin: 0 }}>Chapters go into the MP4 (players show them as sections) and into the published guide.</p>
    </div>
  );
}

/** Find zooms and suggest chapters: the two "do it for me" helpers. */
export function AutoPanel({ edl, canEdit, apply, busy, detail, result, onFind, scenes }: {
  edl: Edl; canEdit: boolean; apply: Apply; busy: boolean; detail: string | null; result: string | null; onFind: () => void; scenes: { srcTime: number; title: string }[];
}) {
  const auto = edl.zooms.filter((z) => z.auto).length;
  return (
    <div className="card pad" style={{ display: "grid", gap: 8 }} data-testid="studio-zoom">
      <h2 className="card-h" style={{ margin: 0 }}><ZoomIn size={16} aria-hidden /> Zoom and chapters</h2>
      <p className="meta" style={{ margin: 0 }}>Finds where you clicked or typed (small parts of the screen changing) and zooms in there, easing in and out. Found zooms are marked “A”: check each one. Running it again replaces only the found zooms{auto ? ` (${auto} now)` : ""}.</p>
      <button className="btn primary" style={{ justifySelf: "start" }} disabled={!canEdit || busy} onClick={onFind} data-testid="find-zooms">
        <ZoomIn size={14} aria-hidden /> {busy ? detail ?? "Working…" : "Zoom in on clicks"}
      </button>
      {result && !busy && <p className="meta" role="status" style={{ margin: 0 }} data-testid="zoom-result">{result}</p>}
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <button className="btn sm" disabled={!canEdit || !scenes.length} onClick={() => apply(setChapters(edl, scenes, () => newId("k")))} data-testid="suggest-chapters"
          title={scenes.length ? "Uses the scenes found when the draft was made" : "This project has no scenes"}>
          <Bookmark size={14} aria-hidden /> {edl.chapters.length ? "Replace chapters with the scenes" : `Add chapters from the ${scenes.length} scenes`}
        </button>
      </div>
    </div>
  );
}

export function FormatPanel({ edl, canEdit, apply }: { edl: Edl; canEdit: boolean; apply: Apply }) {
  return (
    <div className="card pad" style={{ display: "grid", gap: 8 }} data-testid="studio-format">
      <h2 className="card-h" style={{ margin: 0 }}><Clapperboard size={16} aria-hidden /> Shape</h2>
      <label className="f">Aspect ratio
        <select className="in" value={edl.output.aspect} disabled={!canEdit} onChange={(e) => apply(setOptions(edl, { output: { ...edl.output, aspect: e.target.value as Aspect } }))} data-testid="output-aspect">
          {ASPECTS.map((a) => <option key={a} value={a}>{ASPECT_LABEL[a]}</option>)}
        </select>
      </label>
      {edl.output.aspect !== "16:9" && (
        <fieldset className="f" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="meta">The screen in a {edl.output.aspect} frame</legend>
          <label className="check"><input type="radio" name="fit" checked={edl.output.fit === "fit"} disabled={!canEdit} onChange={() => apply(setOptions(edl, { output: { ...edl.output, fit: "fit" } }))} /><span>Show the whole screen<small>With bars above and below</small></span></label>
          <label className="check"><input type="radio" name="fit" checked={edl.output.fit === "fill"} disabled={!canEdit} onChange={() => apply(setOptions(edl, { output: { ...edl.output, fit: "fill" } }))} data-testid="output-fill" /><span>Fill the frame<small>Crops the sides; follows the zooms</small></span></label>
        </fieldset>
      )}
    </div>
  );
}

let logoCache: Promise<LogoImage | null> | null = null;
function browserLogo(): Promise<LogoImage | null> {
  logoCache ??= fetch("/brand/essilorluxottica_logo.svg").then((r) => r.text()).then((svg) => new Promise<LogoImage | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ image: img, width: 620, height: 90 });
    img.onerror = () => resolve(null);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(logoSvg(svg, "#FFFFFF"))}`;
  })).catch(() => null);
  return logoCache;
}

/** The intro or outro card, drawn by the same code as the render, at a small size. */
export function CardPreview({ kind, template, title, subtitle, aspect, height = 135, testId }: { kind: "intro" | "outro"; template: BrandTemplate; title: string; subtitle: string; aspect: Aspect; height?: number; testId?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [w, h] = aspect === "16:9" ? [1280, 720] : aspect === "1:1" ? [960, 960] : [720, 1280];
  useEffect(() => {
    let live = true;
    void browserLogo().then((logo) => {
      const c = ref.current;
      if (!live || !c) return;
      c.width = w; c.height = h;
      const g = c.getContext("2d");
      if (g) drawCard(g as unknown as BrandCtx, w, h, { kind, title, subtitle, template, logo });
    });
    return () => { live = false; };
  }, [kind, template, title, subtitle, w, h]);
  return <canvas ref={ref} style={{ width: (height * w) / h, height, borderRadius: 6, display: "block" }} aria-label={`${kind === "intro" ? "Intro" : "Outro"} card preview`} role="img" data-testid={testId} />;
}

export function BrandPanel({ edl, canEdit, apply, template, project }: { edl: Edl; canEdit: boolean; apply: Apply; template: BrandTemplate; project: { title: string; businessFunction: string; version: number; owner: string } }) {
  const set = (patch: Partial<Edl["brand"]>) => apply(setOptions(edl, { brand: { ...edl.brand, ...patch } }));
  return (
    <div className="card pad" style={{ display: "grid", gap: 6 }} data-testid="studio-brand">
      <h2 className="card-h" style={{ margin: 0 }}>Brand</h2>
      <label className="check"><input type="checkbox" checked={edl.brand.intro} disabled={!canEdit} onChange={(e) => set({ intro: e.target.checked })} data-testid="brand-intro" /><span>Intro card<small>{template.introSec} s with the title, before the video</small></span></label>
      {edl.brand.intro && <CardPreview kind="intro" template={template} title={project.title} subtitle={`${project.businessFunction} · version ${project.version}`} aspect={edl.output.aspect} testId="intro-preview" />}
      <label className="check"><input type="checkbox" checked={edl.brand.lowerThird} disabled={!canEdit} onChange={(e) => set({ lowerThird: e.target.checked })} data-testid="brand-lower-third" /><span>Title at the start<small>Lower third for the first {template.lowerThirdSec} s (shown in the preview)</small></span></label>
      <label className="check"><input type="checkbox" checked={edl.brand.outro} disabled={!canEdit} onChange={(e) => set({ outro: e.target.checked })} data-testid="brand-outro" /><span>Outro card<small>{template.outroSec} s at the end</small></span></label>
      {edl.brand.outro && <CardPreview kind="outro" template={template} title={project.title} subtitle={`Owner: ${project.owner}`} aspect={edl.output.aspect} />}
      <p className="meta" style={{ margin: 0 }}>Colours, texts and timings come from the brand template in Brand Center. Intro and outro cards are added in the render; the timeline shows the edited video only.</p>
    </div>
  );
}

export function MusicPanel({ edl, canEdit, apply, tracks }: { edl: Edl; canEdit: boolean; apply: Apply; tracks: MusicTrack[] }) {
  const set = (patch: Partial<Edl["music"]>) => apply(setOptions(edl, { music: { ...edl.music, ...patch } }));
  const audio = useRef<HTMLAudioElement>(null);
  const [listening, setListening] = useState(false);
  const track = tracks.find((t) => t.id === edl.music.track) ?? null;
  const listen = () => { const a = audio.current; if (!a) return; if (listening) { a.pause(); setListening(false); } else { a.volume = edl.music.volume; a.currentTime = 0; void a.play().then(() => setListening(true)).catch(() => {}); } };
  return (
    <div className="card pad" style={{ display: "grid", gap: 6 }} data-testid="studio-music">
      <h2 className="card-h" style={{ margin: 0 }}><Music size={16} aria-hidden /> Music</h2>
      <label className="f">Background music
        <select className="in" value={edl.music.track ?? ""} disabled={!canEdit} onChange={(e) => { audio.current?.pause(); setListening(false); set({ track: e.target.value || null }); }} data-testid="music-track">
          <option value="">None</option>
          {tracks.map((t) => <option key={t.id} value={t.id}>{t.title} · {t.note}</option>)}
        </select>
      </label>
      {edl.music.track && !track && <p className="meta" role="alert" style={{ margin: 0, color: "var(--warning)" }}>That track was removed from the library; the render will have no music. Choose another.</p>}
      {track && (
        <>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn sm" onClick={listen} type="button">{listening ? <><Pause size={14} aria-hidden /> Stop</> : <><Play size={14} aria-hidden /> Listen</>}</button>
            <label className="row" style={{ gap: 6, flex: 1 }}><span className="meta">Volume</span>
              <input type="range" min={0.05} max={0.6} step={0.05} value={edl.music.volume} disabled={!canEdit} onChange={(e) => { const volume = Number(e.target.value); if (audio.current) audio.current.volume = volume; set({ volume }); }} style={{ flex: 1 }} aria-label="Music volume" data-testid="music-volume" />
            </label>
          </div>
          <audio ref={audio} src={track.url} preload="none" loop onEnded={() => setListening(false)} />
          <label className="check"><input type="checkbox" checked={edl.music.duck} disabled={!canEdit} onChange={(e) => set({ duck: e.target.checked })} /><span>Quieter while someone speaks<small>The music dips under the voice</small></span></label>
        </>
      )}
      <p className="meta" style={{ margin: 0 }}>Built-in tracks are generated by Studio, so there are no licence terms. Brand administrators can add company-licensed tracks in Brand Center.</p>
    </div>
  );
}

export function VoicePanel({ edl, canEdit, apply, languages, primaryLanguage, voices, ttsLanguages, burnedCaptions }: {
  edl: Edl; canEdit: boolean; apply: Apply; languages: { code: string; label: string }[]; primaryLanguage: string; voices: readonly { id: string; label: string }[]; ttsLanguages: string[]; burnedCaptions: boolean;
}) {
  const lang = edl.captionLanguage ?? primaryLanguage;
  const speaks = ttsLanguages.includes(lang) ? lang : ttsLanguages.includes(primaryLanguage) ? primaryLanguage : null;
  return (
    <div className="card pad" style={{ display: "grid", gap: 6 }} data-testid="studio-voice">
      <h2 className="card-h" style={{ margin: 0 }}>Voice and captions</h2>
      <label className="f">Caption language
        <select className="in" value={lang} disabled={!canEdit} onChange={(e) => apply(setOptions(edl, { captionLanguage: e.target.value === primaryLanguage ? null : e.target.value }))} data-testid="caption-language">
          {languages.map((l) => <option key={l.code} value={l.code}>{l.label}{l.code === primaryLanguage ? " (original)" : ""}</option>)}
        </select>
      </label>
      <p className="meta" style={{ margin: 0 }}>{burnedCaptions ? "This video already has captions in the picture, so Studio doesn't add a second set. " : "Burned into the picture in this language. "}Every language with a translated script is also added as a subtitle track that viewers can switch on.{languages.length < 2 ? " Translate the script on the Translations tab to add more." : ""}</p>
      <label className="check"><input type="checkbox" checked={edl.voice.ai} disabled={!canEdit || !speaks} onChange={(e) => apply(setOptions(edl, { voice: { ...edl.voice, ai: e.target.checked } }))} data-testid="voice-ai" />
        <span>AI voice instead of the recorded narration<small>{speaks ? `Reads the script in ${languages.find((l) => l.code === speaks)?.label ?? speaks}, timed to the captions` : `The voice model speaks ${ttsLanguages.join(", ")} only`}</small></span></label>
      {edl.voice.ai && (
        <label className="f">Voice
          <select className="in" value={edl.voice.voice} disabled={!canEdit} onChange={(e) => apply(setOptions(edl, { voice: { ...edl.voice, voice: e.target.value } }))} data-testid="voice-name">
            {voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
        </label>
      )}
      {edl.voice.ai && <p className="meta" style={{ margin: 0 }}>The preview plays the recorded sound; the AI voice (Kokoro, on this server) is in the render.</p>}
    </div>
  );
}

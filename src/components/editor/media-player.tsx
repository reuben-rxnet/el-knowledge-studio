"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Pause, Play, Square, Volume2 } from "lucide-react";
import { mmss } from "@/lib/utilities/format";
import { PlayerScreen } from "./player-screen";

interface Scene { id: string; title: string; startSec: number; endSec: number; focusZoom: boolean; redaction: boolean }
interface Segment { id: string; startSec: number; endSec: number; text: string }
interface Lang { code: string; label: string; texts: Record<string, string> }

// --- Local voices only -------------------------------------------------------------------
// "Online" voices (e.g. Edge's Natural voices) send the text to a cloud service, so only voices that
// run on this PC (localService) are offered. Voices load asynchronously; the list is cached so the
// snapshot stays stable between renders.
let voiceCache: SpeechSynthesisVoice[] = [];
const readVoices = () => (typeof speechSynthesis === "undefined" ? [] : speechSynthesis.getVoices().filter((v) => v.localService));
const subscribeVoices = (cb: () => void) => {
  if (typeof speechSynthesis === "undefined") return () => {};
  const on = () => { voiceCache = readVoices(); cb(); };
  speechSynthesis.addEventListener("voiceschanged", on);
  return () => speechSynthesis.removeEventListener("voiceschanged", on);
};
const voicesSnapshot = () => {
  if (!voiceCache.length) { const v = readVoices(); if (v.length) voiceCache = v; }
  return voiceCache;
};
const noVoices: SpeechSynthesisVoice[] = [];

export function MediaPlayer({ projectId, hasRecording, duration, scenes, segments, languages, sceneId, onScene, scenePages = [] }: {
  projectId: string; hasRecording: boolean; duration: number; scenes: Scene[]; segments: Segment[]; languages: Lang[]; scenePages?: (string | null)[];
  sceneId: string; onScene: (id: string) => void;
}) {
  const [mode, setMode] = useState<"video" | "narration">(hasRecording ? "video" : "narration");
  const [lang, setLang] = useState(languages[0]?.code ?? "en");
  const [speed, setSpeed] = useState(1);
  const [captions, setCaptions] = useState(true);
  const [speaking, setSpeaking] = useState<"idle" | "playing" | "paused">("idle");
  const [voiceName, setVoiceName] = useState<string>("");
  const video = useRef<HTMLVideoElement>(null);
  const fromPlayer = useRef(false);
  const speakIdx = useRef(0);

  const voices = useSyncExternalStore(subscribeVoices, voicesSnapshot, () => noVoices);
  const langVoices = voices.filter((v) => v.lang.toLowerCase().startsWith(lang.toLowerCase()));
  const voice = langVoices.find((v) => v.name === voiceName) ?? langVoices[0];
  const language = languages.find((l) => l.code === lang) ?? languages[0];
  const idx = Math.max(0, scenes.findIndex((s) => s.id === sceneId));
  const scene = scenes[idx]!;
  const textOf = (i: number) => { const seg = segments[i]; return seg ? language?.texts[seg.id] ?? seg.text : ""; };

  // A chapter picked in the editor moves the video; a chapter reached by playback updates the editor.
  useEffect(() => {
    if (fromPlayer.current) { fromPlayer.current = false; return; }
    if (mode === "video" && video.current && Math.abs(video.current.currentTime - scene.startSec) > 1) video.current.currentTime = scene.startSec;
  }, [scene.startSec, mode]);
  useEffect(() => { if (video.current) video.current.playbackRate = speed; }, [speed]);
  useEffect(() => () => { if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel(); }, []);

  function onTime() {
    const t = video.current?.currentTime ?? 0;
    const s = scenes.find((x) => t >= x.startSec && t < x.endSec);
    if (s && s.id !== sceneId) { fromPlayer.current = true; onScene(s.id); }
  }

  function speakFrom(i: number) {
    if (typeof speechSynthesis === "undefined") return;
    speechSynthesis.cancel();
    if (i >= scenes.length) { setSpeaking("idle"); return; }
    speakIdx.current = i;
    const sc = scenes[i];
    if (sc && sc.id !== sceneId) { fromPlayer.current = true; onScene(sc.id); }
    const u = new SpeechSynthesisUtterance(textOf(i));
    u.lang = voice?.lang ?? lang;
    if (voice) u.voice = voice;
    u.rate = speed;
    u.onend = () => { if (speakIdx.current === i) speakFrom(i + 1); };
    u.onerror = () => setSpeaking("idle");
    speechSynthesis.speak(u);
    setSpeaking("playing");
  }
  const pauseResume = () => {
    if (speaking === "playing") { speechSynthesis.pause(); setSpeaking("paused"); }
    else if (speaking === "paused") { speechSynthesis.resume(); setSpeaking("playing"); }
    else speakFrom(idx);
  };
  const stopSpeaking = () => { speakIdx.current = -1; speechSynthesis.cancel(); setSpeaking("idle"); };

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {mode === "video" ? (
        <video ref={video} className="player" style={{ width: "100%", display: "block" }} controls preload="metadata" src={`/api/projects/${projectId}/media`} onTimeUpdate={onTime} aria-label={`Recording, chapter ${idx + 1}: ${scene.title}`}>
          {captions && languages.map((l) => <track key={l.code} kind="captions" srcLang={l.code} label={l.label} src={`/api/projects/${projectId}/captions?lang=${l.code}`} default={l.code === lang} />)}
        </video>
      ) : (
        <div className="player" role="img" aria-label={`Narration preview, chapter ${idx + 1}: ${scene.title}`}>
          <PlayerScreen scene={scene} index={idx} caption={captions ? textOf(idx) : null} image={scenePages[idx] ?? null} />
        </div>
      )}

      <div className="row controls" style={{ flexWrap: "wrap" }}>
        {mode === "narration" && <>
          <button className="iconbtn" onClick={pauseResume} aria-label={speaking === "playing" ? "Pause narration" : "Play narration"} disabled={!voice}>{speaking === "playing" ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}</button>
          <button className="iconbtn" onClick={stopSpeaking} aria-label="Stop narration" disabled={speaking === "idle"}><Square size={14} aria-hidden /></button>
          <span className="meta" style={{ fontVariantNumeric: "tabular-nums" }}>Chapter {idx + 1} of {scenes.length}</span>
        </>}
        {mode === "video" && <span className="meta" style={{ fontVariantNumeric: "tabular-nums" }}>{mmss(scene.startSec)} / {mmss(duration)}</span>}
        <span className="spacer" />
        <label className="row" style={{ gap: 6 }}><span className="meta">Language</span>
          <select className="in" style={{ width: "auto" }} value={lang} onChange={(e) => { setLang(e.target.value); stopSpeaking(); }} aria-label="Caption and narration language">
            {languages.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </label>
        <label className="row" style={{ gap: 6 }}><span className="meta">Speed</span>
          <select className="in" style={{ width: "auto" }} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Playback speed">
            {[0.75, 1, 1.25, 1.5].map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        </label>
        <button className="btn sm" aria-pressed={captions} onClick={() => setCaptions((c) => !c)}>Captions</button>
        {hasRecording && <button className="btn sm" aria-pressed={mode === "narration"} onClick={() => { stopSpeaking(); setMode(mode === "video" ? "narration" : "video"); }}><Volume2 size={14} aria-hidden /> {mode === "video" ? "Preview narration" : "Back to recording"}</button>}
      </div>

      {mode === "narration" && (
        <div className="row" style={{ gap: 8 }}>
          {langVoices.length ? (
            <label className="row" style={{ gap: 6 }}><span className="meta">Voice</span>
              <select className="in" style={{ width: "auto", maxWidth: 320 }} value={voice?.name ?? ""} onChange={(e) => setVoiceName(e.target.value)} aria-label="Preview voice">
                {langVoices.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
              </select>
            </label>
          ) : (
            <span className="callout warn" style={{ padding: "6px 10px" }}><b>No {language?.label ?? lang} voice on this PC.</b>&nbsp;Add one in Windows Settings › Time &amp; language › Speech, then reload.</span>
          )}
          <span className="meta">Preview voice from this PC: the text stays on your device. Final AI voiceover needs a text-to-speech model on the gateway.</span>
        </div>
      )}
    </div>
  );
}

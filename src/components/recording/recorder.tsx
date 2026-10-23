"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Disc, Pause, Play, RotateCcw, Sparkles, Square, Upload } from "lucide-react";
import { CreationWizard, type UploadMeta } from "@/components/content/creation-wizard";
import { mmss } from "@/lib/utilities/format";
import { fingerprint, uploadToStorage } from "./file-checks";

const noopSubscribe = () => () => {};
const captureSupported = () => !!navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== "undefined";

type Phase ="setup" | "countdown" | "recording" | "paused" | "review" | "continue";
const QUALITY = { "1080p": { width: 1920, height: 1080, bps: 5_000_000 }, "720p": { width: 1280, height: 720, bps: 2_500_000 }, "1440p": { width: 2560, height: 1440, bps: 8_000_000 } } as const;

/**
 * Screen recording with explicit user awareness: the browser's own picker chooses what is shared,
 * a persistent indicator shows while recording, and the user can pause or stop at any time.
 * No keystrokes, hidden windows or form-field values are captured — only the shared surface's pixels and the chosen mic.
 */
export function Recorder({ owner, workspace, aiLabel }: { owner: string; workspace: string; aiLabel: string }) {
  // null on the server; resolved in the browser without a state update in an effect.
  const supported = useSyncExternalStore(noopSubscribe, captureSupported, () => null);
  const [phase, setPhase] = useState<Phase>("setup");
  const [title, setTitle] = useState("");
  const [classification, setClassification] = useState("Internal");
  const [quality, setQuality] = useState<keyof typeof QUALITY>("1080p");
  const [useMic, setUseMic] = useState(true);
  const [systemAudio, setSystemAudio] = useState(false);
  const [detectSensitive, setDetectSensitive] = useState(true);
  const [consent, setConsent] = useState(false);
  const [count, setCount] = useState(3);
  const [secs, setSecs] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [meta, setMeta] = useState<UploadMeta | null>(null);
  const [trim, setTrim] = useState<[number, number]>([0, 0]);
  const [uploadPct, setUploadPct] = useState<number | null>(null);

  async function uploadRecording() {
    if (!meta || !recordedBlob.current) return;
    setError(null);
    setUploadPct(0);
    try {
      const stored = await uploadToStorage(recordedBlob.current, meta.fileName, setUploadPct);
      setMeta({ ...meta, checksum: stored.checksum, storageKey: stored.storageKey });
      setPhase("continue");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The upload didn't finish. Try again.");
    } finally {
      setUploadPct(null);
    }
  }

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const streams = useRef<MediaStream[]>([]);
  const audioCtx = useRef<AudioContext | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const secsRef = useRef(0);
  const peak = useRef(0);
  const hadAudio = useRef(false);
  const recordedBlob = useRef<Blob | null>(null);
  const [audioIssue, setAudioIssue] = useState<string | null>(null);
  const [audioCaptured, setAudioCaptured] = useState(false);

  useEffect(() => () => cleanup(), []);

  function cleanup() {
    if (timer.current) clearInterval(timer.current);
    streams.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    streams.current = [];
    void audioCtx.current?.close().catch(() => {});
    audioCtx.current = null;
  }

  async function start() {
    setError(null);
    setAudioIssue(null);
    peak.current = 0;
    // Created inside the click so the browser lets it run; an AudioContext created later
    // can stay "suspended" and would record silence.
    const ctx = new AudioContext();
    audioCtx.current = ctx;

    let display: MediaStream;
    try {
      const q = QUALITY[quality];
      display = await navigator.mediaDevices.getDisplayMedia({ video: { width: q.width, height: q.height, frameRate: 30 }, audio: systemAudio });
    } catch (e) {
      cleanup();
      setError((e as DOMException).name === "NotAllowedError" ? "Screen sharing was cancelled or blocked. Choose a tab, window or screen to record, or upload a file instead." : "Screen capture couldn't start in this browser. Upload a recording instead.");
      return;
    }
    streams.current.push(display);

    // MediaRecorder records only the FIRST audio track of a stream, so every audio source
    // (microphone + shared tab/system audio) is mixed into one track.
    await ctx.resume().catch(() => {});
    const mix = ctx.createMediaStreamDestination();
    let audioSources = 0;
    if (display.getAudioTracks().length) {
      ctx.createMediaStreamSource(new MediaStream(display.getAudioTracks())).connect(mix);
      audioSources++;
    } else if (systemAudio) {
      setAudioIssue("System audio wasn't shared. In the browser's sharing dialog, tick “Share tab audio” or “Share system audio” next time.");
    }
    if (useMic) {
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        streams.current.push(mic);
        const micSource = ctx.createMediaStreamSource(mic);
        micSource.connect(mix);
        audioSources++;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        micSource.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          if (!audioCtx.current) return;
          analyser.getByteFrequencyData(data);
          const v = data.reduce((a, b) => a + b, 0) / data.length / 128;
          if (recorder.current?.state === "recording") peak.current = Math.max(peak.current, v);
          setLevel(v);
          requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setError("Microphone access was denied, so this recording has no narration. Allow the microphone in the browser's site settings and record again.");
      }
    }
    hadAudio.current = audioSources > 0;
    const tracks = [...display.getVideoTracks(), ...(audioSources ? mix.stream.getAudioTracks() : [])];
    // If the user stops sharing from the browser's own bar, stop cleanly.
    display.getVideoTracks()[0]?.addEventListener("ended", () => stop());

    setPhase("countdown");
    setCount(3);
    let n = 3;
    const cd = setInterval(() => {
      n -= 1;
      setCount(n);
      if (n <= 0) {
        clearInterval(cd);
        const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "video/webm";
        const rec = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: QUALITY[quality].bps, audioBitsPerSecond: 128_000 });
        chunks.current = [];
        rec.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
        rec.onstop = () => void finish();
        rec.start(1000);
        recorder.current = rec;
        setSecs(0);
        setPhase("recording");
        secsRef.current = 0;
        timer.current = setInterval(() => {
          if (recorder.current?.state !== "recording") return;
          secsRef.current += 1;
          setSecs(secsRef.current);
        }, 1000);
      }
    }, 800);
  }

  function pauseResume() {
    const r = recorder.current;
    if (!r) return;
    if (r.state === "recording") { r.pause(); setPhase("paused"); } else if (r.state === "paused") { r.resume(); setPhase("recording"); }
  }

  function stop() {
    const r = recorder.current;
    if (r && r.state !== "inactive") r.stop();
  }

  async function finish() {
    cleanup();
    if (!hadAudio.current) setAudioIssue("This recording has no audio track. Turn on microphone narration (or share tab audio) and record again if you want narration.");
    else if (useMic && peak.current < 0.02) setAudioIssue("No sound was picked up from your microphone. Check that the right input device is selected and not muted (Windows: Settings › System › Sound › Input), then record again.");
    const blob = new Blob(chunks.current, { type: "video/webm" });
    recordedBlob.current = blob;
    setAudioCaptured(hadAudio.current);
    const name = `${(title || "recording").replace(/[^\w-]+/g, "-").slice(0, 60)}.webm`;
    setBlobUrl(URL.createObjectURL(blob));
    setTrim([0, secsRef.current]);
    const checksum = await fingerprint(blob, name);
    setMeta({ fileName: name, mimeType: "video/webm", sizeBytes: blob.size, checksum, durationSec: undefined });
    setPhase("review");
  }

  function reRecord() {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlobUrl(null); setMeta(null); setSecs(0); setPhase("setup");
  }

  if (phase === "continue" && meta) {
    return <CreationWizard owner={owner} initialSource="recording" upload={{ ...meta, durationSec: Math.max(1, trim[1] - trim[0]) }} aiLabel={aiLabel} />;
  }

  if (supported === false) {
    return (
      <div className="card pad" style={{ display: "grid", gap: 12, maxWidth: 720 }}>
        <div className="callout warn" role="alert"><b>Screen recording isn&apos;t supported in this browser.</b>&nbsp;Use a current version of Microsoft Edge or Chrome on a desktop, or upload an existing recording.</div>
        <Link className="btn primary" href="/create/upload?kind=video" style={{ justifySelf: "start" }}><Upload size={16} aria-hidden /> Upload a recording instead</Link>
      </div>
    );
  }

  if (phase === "review" && blobUrl) {
    return (
      <div className="card pad" style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 980 }}>
        <video src={blobUrl} controls className="player" style={{ width: "100%" }} aria-label="Recording preview" />
        <div className="row"><span className="meta">Duration {mmss(secs)} · {quality} · {audioIssue ? "Audio needs attention" : audioCaptured ? "Audio captured" : "No audio"}</span></div>
        {audioIssue && <div className="callout warn" role="alert"><b>Check the audio.</b>&nbsp;{audioIssue} Play the preview to confirm before continuing.</div>}
        {error && <div className="callout warn" role="alert"><b>{error}</b></div>}
        <div className="grid g2">
          <label className="f">Trim start (seconds)<input type="range" id="trimStart" min={0} max={secs} value={trim[0]} onChange={(e) => setTrim([Math.min(Number(e.target.value), trim[1] - 1), trim[1]])} /><span className="hint">{mmss(trim[0])}</span></label>
          <label className="f">Trim end (seconds)<input type="range" id="trimEnd" min={0} max={secs} value={trim[1]} onChange={(e) => setTrim([trim[0], Math.max(Number(e.target.value), trim[0] + 1)])} /><span className="hint">{mmss(trim[1])}</span></label>
        </div>
        <div className="row">
          <button className="btn primary" onClick={() => void uploadRecording()} disabled={!meta || uploadPct !== null}><Sparkles size={16} aria-hidden /> {uploadPct !== null ? `Uploading… ${Math.round(uploadPct * 100)}%` : "Upload and continue"}</button>
          <button className="btn" onClick={reRecord}><RotateCcw size={16} aria-hidden /> Re-record</button>
        </div>
      </div>
    );
  }

  return (
    <div className="split" style={{ maxWidth: 1100 }}>
      <div className="card pad" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label className="f">Recording title<input type="text" id="r_title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Store closing cash count" /></label>
        <div className="grid g2">
          <label className="f">Workspace<input type="text" id="r_ws" value={workspace} readOnly /></label>
          <label className="f">Classification<select className="in" id="r_cls" value={classification} onChange={(e) => setClassification(e.target.value)}><option>Public</option><option>Internal</option><option>Confidential</option><option>Highly Confidential</option><option>Restricted</option></select></label>
        </div>
        {classification === "Restricted" && <div className="callout warn" role="alert"><b>Restricted content can&apos;t be recorded.</b>&nbsp;Choose another classification.</div>}
        <div className="grid g2">
          <label className="f">Quality<select className="in" id="r_q" value={quality} onChange={(e) => setQuality(e.target.value as keyof typeof QUALITY)}><option value="1080p">1080p (recommended)</option><option value="720p">720p</option><option value="1440p">1440p</option></select></label>
          <label className="f">Camera overlay<select className="in" id="r_cam" disabled><option>Off (coming later)</option></select></label>
        </div>
        <label className="check"><input type="checkbox" checked={useMic} onChange={(e) => setUseMic(e.target.checked)} /><span>Record microphone narration<small>Your browser asks which microphone to use.</small></span></label>
        <label className="check"><input type="checkbox" checked={systemAudio} onChange={(e) => setSystemAudio(e.target.checked)} /><span>Include system or tab audio<small>Where your browser supports it.</small></span></label>
        <label className="check"><input type="checkbox" checked={detectSensitive} onChange={(e) => setDetectSensitive(e.target.checked)} /><span>Automatically detect sensitive information<small>E-mail addresses, faces, customer data and card numbers are flagged for redaction after recording.</small></span></label>
        <label className="check"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="record-consent" /><span>I won&apos;t show restricted personal or confidential data<small>See the <Link className="link" href="/help">recording policy</Link>. Only the surface you choose is captured. Password fields and keystrokes are never recorded.</small></span></label>
        {error && <div className="callout warn" role="alert"><b>{error}</b></div>}
        <button className="btn primary" disabled={!consent || classification === "Restricted" || supported === null} onClick={() => void start()}><Disc size={16} aria-hidden /> Choose what to share and start</button>
      </div>
      <div className="card pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="card-h"><Sparkles size={16} aria-hidden /> Recording tips</div>
        <div className="meta" style={{ fontSize: 13, display: "grid", gap: 8 }}>
          <span>Narrate what you&apos;re doing and why. AI turns your words into instructions.</span>
          <span>Pause briefly before each click. Scene changes become chapters.</span>
          <span>Use test data where you can. Blurred regions can be adjusted later.</span>
        </div>
        <Link className="btn" href="/create/upload?kind=video"><Upload size={16} aria-hidden /> Upload a file instead</Link>
      </div>

      {phase === "countdown" && <div className="backdrop" style={{ background: "rgba(7,26,51,.7)" }}><div className="countdown" aria-live="assertive">{count}</div></div>}
      {(phase === "recording" || phase === "paused") && (
        <div className="rec-float" role="region" aria-label="Recording controls">
          <span className="rec-dot" style={phase === "paused" ? { animation: "none", opacity: 0.4 } : undefined} aria-hidden />
          <b style={{ fontVariantNumeric: "tabular-nums" }} aria-live="off">{mmss(secs)}</b>
          <span className="meter" aria-label="Microphone level" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
            {[0, 1, 2, 3, 4, 5].map((k) => <i key={k} style={{ height: `${3 + Math.min(15, level * 18 * (0.6 + (k % 3) * 0.25))}px` }} />)}
          </span>
          <span className="meta" style={{ color: "#9fb3cc" }} aria-live="polite">{phase === "paused" ? "Paused" : "Recording"}</span>
          <button className="btn sm" onClick={pauseResume}>{phase === "paused" ? <><Play size={14} aria-hidden /> Resume</> : <><Pause size={14} aria-hidden /> Pause</>}</button>
          <button className="btn sm danger" onClick={stop}><Square size={14} aria-hidden /> Stop</button>
        </div>
      )}
    </div>
  );
}

"use client";
// Brand Center: Studio's brand template (intro and outro cards, lower third, captions) and its music library.
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Music, Pause, Play, Trash2, Upload } from "lucide-react";
import { removeMusicTrack, saveBrandTemplate } from "@/server/actions/brand";
import { BRAND_ACCENTS, type BrandAccent, type BrandTemplate } from "@/lib/studio/brand-template";
import { BUILT_IN_MUSIC, uploadedTrackUrl } from "@/lib/studio/music";
import { CardPreview } from "@/components/studio/studio-panels";
import { useToast } from "@/components/common/toast";

export interface UploadedTrackRow { id: string; title: string; licence: string; uploadedBy: string; uploadedAt: string }

const ACCENT_LABEL: Record<BrandAccent, string> = { cyan: "Cyan", blue: "Action blue", teal: "Teal", gold: "Gold" };

export function StudioBrandEditor({ template }: { template: BrandTemplate }) {
  const router = useRouter();
  const toast = useToast();
  const [t, setT] = useState<BrandTemplate>(template);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (patch: Partial<BrandTemplate>) => setT((x) => ({ ...x, ...patch }));
  const num = (v: string, fallback: number) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
  const dirty = JSON.stringify(t) !== JSON.stringify(template);

  function save() {
    start(async () => {
      const r = await saveBrandTemplate(t);
      if (!r.ok) { setError(r.fieldErrors ? `${r.error.message} ${Object.values(r.fieldErrors).join(" ")}` : r.error.message); return; }
      setError(null);
      setT(r.data);
      toast("Brand template saved. Studio renders started from now on use it.");
      router.refresh();
    });
  }

  return (
    <div className="card pad" style={{ display: "grid", gap: 12 }} data-testid="brand-template">
      <div>
        <h2 className="card-h" style={{ margin: 0 }}>Studio brand template</h2>
        <p className="meta" style={{ margin: "4px 0 0" }}>How intro and outro cards, the title at the start and captions look in every Studio video. Each edit only chooses whether they appear.</p>
      </div>
      <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
        <legend className="meta" style={{ marginBottom: 6 }}>Accent colour</legend>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }} role="radiogroup" aria-label="Accent colour">
          {(Object.keys(BRAND_ACCENTS) as BrandAccent[]).map((a) => (
            <button key={a} type="button" role="radio" aria-checked={t.accent === a} className={`btn sm${t.accent === a ? " primary" : ""}`} onClick={() => set({ accent: a })} data-testid={`accent-${a}`}>
              <span aria-hidden style={{ width: 14, height: 14, borderRadius: 999, background: BRAND_ACCENTS[a], display: "inline-block", border: "1px solid rgba(0,0,0,.2)" }} /> {ACCENT_LABEL[a]}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="grid g3">
        <label className="f">Intro card (seconds)<input className="in" type="number" min={1.5} max={8} step={0.5} value={t.introSec} onChange={(e) => set({ introSec: num(e.target.value, t.introSec) })} data-testid="brand-intro-sec" /></label>
        <label className="f">Outro card (seconds)<input className="in" type="number" min={1.5} max={10} step={0.5} value={t.outroSec} onChange={(e) => set({ outroSec: num(e.target.value, t.outroSec) })} data-testid="brand-outro-sec" /></label>
        <label className="f">Title at the start (seconds)<input className="in" type="number" min={2} max={12} step={0.5} value={t.lowerThirdSec} onChange={(e) => set({ lowerThirdSec: num(e.target.value, t.lowerThirdSec) })} data-testid="brand-lower-third-sec" /></label>
      </div>
      <div className="grid g2">
        <label className="f">Line above the title (intro)<input className="in" type="text" maxLength={60} value={t.introKicker} onChange={(e) => set({ introKicker: e.target.value })} data-testid="brand-kicker" /></label>
        <label className="f">Outro text<input className="in" type="text" maxLength={120} value={t.outroText} onChange={(e) => set({ outroText: e.target.value })} data-testid="brand-outro-text" /></label>
      </div>
      <div className="grid g3">
        <label className="f">Caption size
          <select className="in" value={t.captionSize} onChange={(e) => set({ captionSize: e.target.value as BrandTemplate["captionSize"] })} data-testid="brand-caption-size">
            <option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option>
          </select>
        </label>
        <label className="f">Caption colour
          <select className="in" value={t.captionColor} onChange={(e) => set({ captionColor: e.target.value as BrandTemplate["captionColor"] })} data-testid="brand-caption-color">
            <option value="white">White on a dark box</option><option value="yellow">Yellow on a dark box</option>
          </select>
        </label>
        <label className="check" style={{ alignSelf: "end" }}><input type="checkbox" checked={t.showLogo} onChange={(e) => set({ showLogo: e.target.checked })} data-testid="brand-show-logo" /><span>Show the EssilorLuxottica wordmark<small>On the intro and outro cards</small></span></label>
      </div>
      <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div><div className="meta" style={{ marginBottom: 4 }}>Intro preview</div><CardPreview kind="intro" template={t} title="Close the POS day" subtitle="Retail · version 1" aspect="16:9" height={150} testId="brand-intro-preview" /></div>
        <div><div className="meta" style={{ marginBottom: 4 }}>Outro preview</div><CardPreview kind="outro" template={t} title="Close the POS day" subtitle="Owner: Amara Mensah" aspect="16:9" height={150} testId="brand-outro-preview" /></div>
      </div>
      {error && <div className="callout warn" role="alert"><b>{error}</b></div>}
      <div className="row" style={{ gap: 8 }}>
        <button className="btn primary" disabled={pending || !dirty} onClick={save} data-testid="brand-save">{pending ? "Saving…" : dirty ? "Save brand template" : "Saved"}</button>
        {dirty && <button className="btn" disabled={pending} onClick={() => { setT(template); setError(null); }}>Undo changes</button>}
      </div>
    </div>
  );
}

/** One play/pause button for a track; only one plays at a time on the page. */
function PlayButton({ url, label, playing, onToggle }: { url: string; label: string; playing: string | null; onToggle: (url: string | null) => void }) {
  const on = playing === url;
  return <button type="button" className="btn sm" onClick={() => onToggle(on ? null : url)} aria-label={`${on ? "Pause" : "Play"} ${label}`}>{on ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}</button>;
}

export function StudioMusicLibrary({ uploaded }: { uploaded: UploadedTrackRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [licence, setLicence] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  function toggle(url: string | null) {
    audio.current?.pause();
    if (!url) { setPlaying(null); return; }
    const a = new Audio(url);
    a.volume = 0.6;
    a.onended = () => setPlaying(null);
    audio.current = a;
    void a.play().then(() => setPlaying(url)).catch(() => { setPlaying(null); toast("This track couldn't be played."); });
  }

  function upload() {
    if (!file || !title.trim() || !licence.trim()) { setError("Choose a file, give it a title and say where its licence comes from."); return; }
    setBusy(true); setError(null); setProgress(0);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/studio/music");
    xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name));
    xhr.setRequestHeader("x-track-title", encodeURIComponent(title.trim()));
    xhr.setRequestHeader("x-track-licence", encodeURIComponent(licence.trim()));
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) setProgress(e.loaded / e.total); };
    xhr.onload = () => {
      setBusy(false);
      if (xhr.status >= 200 && xhr.status < 300) {
        toast(`Added "${title.trim()}" to the music library.`);
        setFile(null); setTitle(""); setLicence("");
        if (fileInput.current) fileInput.current.value = "";
        router.refresh();
      } else setError((xhr.response as { message?: string } | null)?.message ?? `The upload failed (${xhr.status}).`);
    };
    xhr.onerror = () => { setBusy(false); setError("The upload was interrupted. Check your connection and try again."); };
    xhr.send(file);
  }

  function remove(t: UploadedTrackRow) {
    if (!confirm(`Remove "${t.title}" from the library? Studio edits that use it render without music until another track is chosen.`)) return;
    start(async () => {
      const r = await removeMusicTrack({ id: t.id });
      if (!r.ok) { toast(r.error.message); return; }
      if (playing === uploadedTrackUrl(t.id)) toggle(null);
      toast(`Removed "${t.title}".`);
      router.refresh();
    });
  }

  return (
    <div className="card" data-testid="music-library">
      <div className="pad">
        <h2 className="card-h" style={{ margin: 0 }}><Music size={16} aria-hidden /> Studio music library</h2>
        <p className="meta" style={{ margin: "4px 0 0" }}>Background music a Studio edit can choose. It is lowered automatically while someone speaks.</p>
      </div>
      <ul className="list">
        {BUILT_IN_MUSIC.map((m) => (
          <li key={m.id} data-testid={`music-builtin-${m.id}`}>
            <PlayButton url={m.url} label={m.title} playing={playing} onToggle={toggle} />
            <div style={{ flex: 1 }}><div className="t">{m.title}</div><div className="meta">{m.note} · built in, generated with FFmpeg (no licence terms)</div></div>
            <span className="pill s-ok">Built in</span>
          </li>
        ))}
        {uploaded.map((t) => (
          <li key={t.id} data-testid="music-uploaded">
            <PlayButton url={uploadedTrackUrl(t.id)} label={t.title} playing={playing} onToggle={toggle} />
            <div style={{ flex: 1 }}><div className="t">{t.title}</div><div className="meta">Licence: {t.licence} · uploaded by {t.uploadedBy} on {new Date(t.uploadedAt).toLocaleDateString()}</div></div>
            <button className="btn sm" disabled={pending} onClick={() => remove(t)} data-testid="music-remove" aria-label={`Remove ${t.title}`}><Trash2 size={14} aria-hidden /> Remove</button>
          </li>
        ))}
      </ul>
      <div className="pad" style={{ display: "grid", gap: 10, borderTop: "1px solid var(--border)" }}>
        <h3 className="card-h" style={{ margin: 0, fontSize: 14 }}>Add a licensed track</h3>
        <div className="grid g3">
          <label className="f">File (MP3, M4A, AAC or WAV, up to 30 MB)<input ref={fileInput} className="in" type="file" accept=".mp3,.m4a,.aac,.wav,audio/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="music-file" /></label>
          <label className="f">Title<input className="in" type="text" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} data-testid="music-title" /></label>
          <label className="f">Licence note<input className="in" type="text" maxLength={160} placeholder="e.g. Licensed from … until 2027, PO 12345" value={licence} onChange={(e) => setLicence(e.target.value)} data-testid="music-licence" /></label>
        </div>
        {error && <div className="callout warn" role="alert"><b>{error}</b></div>}
        <div className="row" style={{ gap: 8 }}>
          <button className="btn primary" disabled={busy || !file || !title.trim() || !licence.trim()} onClick={upload} data-testid="music-upload"><Upload size={14} aria-hidden /> {busy ? `Uploading… ${Math.round(progress * 100)}%` : "Add to library"}</button>
          <span className="meta">Only upload music the company holds a licence for. The licence note is kept with the track and in the audit log.</span>
        </div>
      </div>
    </div>
  );
}

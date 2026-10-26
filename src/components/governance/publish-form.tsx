"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Film, Send } from "lucide-react";
import { mmss } from "@/lib/utilities/format";
import { publishProject } from "@/server/actions/review";
import { MockLabel } from "@/components/common/badges";
import { useToast } from "@/components/common/toast";

export interface PublishVideo { title: string; engine: string; durationSec: number; chapters: number }

export function PublishForm({ projectId, version, destinations, languages, audience, defaults, video }: {
  projectId: string; version: number; destinations: { key: string; label: string; target: string; allowed: boolean; live: boolean }[];
  languages: { code: string; label: string }[]; audience: string; defaults: string[]; video: PublishVideo | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [sel, setSel] = useState<string[]>(defaults.filter((d) => destinations.find((x) => x.key === d)?.allowed));
  const [lang, setLang] = useState(languages[0]?.code ?? "en");
  const [aud, setAud] = useState(audience);
  const [ack, setAck] = useState(false);
  const [wm, setWm] = useState(true);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const toggle = (k: string) => setSel((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]));

  function publish() {
    if (!sel.length) { setError("Choose at least one destination."); return; }
    start(async () => {
      const r = await publishProject({ projectId, version, destinations: sel, language: lang, audience: aud, requireAck: ack, watermark: wm });
      if (!r.ok) { setError(r.error.message); return; }
      setError(null);
      toast(`Published v${version} to ${r.data.results.map((x) => x.destination).join(", ")}${r.data.results.some((x) => x.simulated) ? " (simulated: no external system was contacted)" : ""}.`);
      router.refresh();
    });
  }

  return (
    <div className="card pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="row between"><h2 className="card-h">Publish version {version}</h2><MockLabel>{destinations.some((d) => d.live) ? `Simulated except ${destinations.filter((d) => d.live).map((d) => d.label).join(", ")}` : "Mock connectors · nothing is sent"}</MockLabel></div>
      {video ? (
        <div className="callout tip" data-testid="publish-video"><Film size={16} aria-hidden /><span><b>Video:</b> {video.title}<span className="meta" style={{ display: "block" }}>{video.engine} render · {mmss(video.durationSec)}{video.chapters ? ` · ${video.chapters} chapter${video.chapters === 1 ? "" : "s"}` : ""}</span></span></div>
      ) : (
        <div className="callout warn" data-testid="publish-video"><Film size={16} aria-hidden /><span><b>No video chosen.</b> Only the guide is published. To include a video, choose “Use for publishing” on a finished render on the Video tab or in Studio.</span></div>
      )}
      <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
        <legend className="sr">Destinations</legend>
        <div className="checks">
          {destinations.map((d) => (
            <label key={d.key} className="check" style={d.allowed ? undefined : { opacity: 0.55 }}>
              <input type="checkbox" checked={sel.includes(d.key)} disabled={!d.allowed} onChange={() => toggle(d.key)} data-testid={`dest-${d.key}`} />
              <span>{d.label}<small>{d.allowed ? `${d.target}${d.live ? " · live" : ""}` : "Not allowed for this classification"}</small></span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid g2">
        <label className="f">Audience<input type="text" id="pAud" value={aud} onChange={(e) => setAud(e.target.value)} /></label>
        <label className="f">Language<select className="in" id="pLang" value={lang} onChange={(e) => setLang(e.target.value)}>{languages.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}</select></label>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /><span>Require acknowledgment<small>Readers confirm they&apos;ve read this version.</small></span></label>
        <label className="check"><input type="checkbox" checked={wm} onChange={(e) => setWm(e.target.checked)} /><span>Add classification watermark</span></label>
      </div>
      {error && <div className="callout warn" role="alert"><b>{error}</b></div>}
      <button className="btn primary" style={{ justifySelf: "start", alignSelf: "flex-start" }} disabled={pending} onClick={publish} data-testid="publish">
        <Send size={16} aria-hidden /> {pending ? "Publishing…" : `Publish to ${sel.length} destination${sel.length === 1 ? "" : "s"}`}
      </button>
    </div>
  );
}

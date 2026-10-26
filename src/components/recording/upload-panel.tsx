"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { CheckCircle2, Clock3, Upload, XCircle } from "lucide-react";
import { validateUpload } from "@/lib/validation/schemas";
import { CATEGORY_META, UPLOAD_CATEGORIES, formatLimit, type UploadLimits } from "@/lib/validation/upload-limits";
import { TrimSplit } from "./trim-split";
import { checkDuplicate } from "@/server/actions/projects";
import { CreationWizard, type UploadMeta } from "@/components/content/creation-wizard";
import type { SourceKind } from "@/lib/domain/constants";
import { fingerprint, mediaDuration, uploadToStorage } from "./file-checks";

type CheckState = "waiting" | "running" | "passed" | "failed";
const CHECKS = ["Extension and type", "Size limit", "Integrity", "Duplicate check", "Upload", "Security scan"] as const;

export function UploadPanel({ owner, aiLabel, limits, preferredKind }: { owner: string; aiLabel: string; limits: UploadLimits; preferredKind?: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [checks, setChecks] = useState<Record<string, CheckState>>({});
  const [error, setError] = useState<{ title: string; body: string } | null>(null);
  const [duplicate, setDuplicate] = useState<{ id: string; title: string } | null>(null);
  const [meta, setMeta] = useState<UploadMeta | null>(null);
  // What the project(s) will be made from: the upload itself, its trimmed copy, or its parts.
  const [parts, setParts] = useState<UploadMeta[]>([]);
  const [cutPending, setCutPending] = useState(false);
  const [mediaKind, setMediaKind] = useState<"video" | "audio" | null>(null);
  const [kind, setKind] = useState<SourceKind>("video");
  const [over, setOver] = useState(false);
  const [ready, setReady] = useState(false);
  const cancelled = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState(0);

  const mark = (k: string, st: CheckState) => setChecks((c) => ({ ...c, [k]: st }));

  async function handle(f: File) {
    cancelled.current = false;
    setFile(f); setError(null); setDuplicate(null); setMeta(null); setParts([]); setCutPending(false); setReady(false); setChecks({});
    mark("Extension and type", "running");
    const check = validateUpload({ name: f.name, type: f.type, size: f.size }, limits);
    setMediaKind(check.ok && (check.kind === "video" || check.kind === "audio") ? check.kind : null);
    if (!check.ok) {
      mark(check.code === "TOO_LARGE" || check.code === "EMPTY_FILE" ? "Size limit" : "Extension and type", "failed");
      setError({ title: "This file can't be used.", body: check.message });
      return;
    }
    mark("Extension and type", "passed"); mark("Size limit", "passed");
    const k: SourceKind = preferredKind === "meeting" ? "meeting" : check.kind;
    setKind(k);
    mark("Integrity", "running");
    let durationSec: number | undefined;
    if (check.kind === "video" || check.kind === "audio") {
      try { durationSec = await mediaDuration(f, check.kind); }
      catch { mark("Integrity", "failed"); setError({ title: "This file looks damaged.", body: "Your browser couldn't read it. Export it again from the original application and retry." }); return; }
    }
    if (cancelled.current) return;
    mark("Integrity", "passed"); mark("Duplicate check", "running");
    const checksum = await fingerprint(f, f.name);
    const dup = await checkDuplicate(checksum);
    if (cancelled.current) return;
    if (dup.ok && dup.data.duplicateOf) setDuplicate(dup.data.duplicateOf);
    mark("Duplicate check", "passed"); mark("Upload", "running");
    abort.current = new AbortController();
    let stored;
    try {
      stored = await uploadToStorage(f, f.name, setProgress, abort.current.signal);
    } catch (e) {
      if (cancelled.current) return;
      mark("Upload", "failed");
      setError({ title: "The upload didn't finish.", body: e instanceof Error ? e.message : "Try again." });
      return;
    }
    mark("Upload", "passed"); mark("Security scan", "passed");
    const uploaded = { fileName: f.name, mimeType: stored.mimeType, sizeBytes: f.size, checksum: stored.checksum, durationSec, storageKey: stored.storageKey };
    setMeta(uploaded);
    setParts([uploaded]);
  }

  function cancel() { cancelled.current = true; abort.current?.abort(); setFile(null); setChecks({}); setError({ title: "Upload cancelled.", body: "Nothing was used. Choose the file again to retry." }); }

  if (ready && meta && parts.length) return <CreationWizard owner={owner} initialSource={kind} upload={parts[0]} parts={parts} aiLabel={aiLabel} />;

  const icon = (st: CheckState | undefined) => st === "passed" ? <CheckCircle2 size={16} color="var(--success)" aria-hidden /> : st === "failed" ? <XCircle size={16} color="var(--error)" aria-hidden /> : <Clock3 size={16} aria-hidden />;
  const done = Object.values(checks).filter((x) => x === "passed").length;

  return (
    <div className="card pad" style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 900 }}>
      <label className={`dropzone${over ? " over" : ""}`} htmlFor="file"
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) void handle(f); }}>
        <Upload size={28} aria-hidden />
        <span className="card-h">Drop a file here or choose one</span>
        <span className="meta" style={{ textAlign: "center" }}>{UPLOAD_CATEGORIES.map((c) => `${CATEGORY_META[c].types} up to ${formatLimit(limits[c])}`).join(" · ")}</span>
        <span className="btn sm">Choose file</span>
        <input id="file" type="file" className="sr" accept=".mp4,.mov,.webm,.mp3,.wav,.pptx,.docx,.pdf,.txt,.png,.jpg,.jpeg" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handle(f); e.target.value = ""; }} />
      </label>
      {error && <div className="callout warn" role="alert"><b>{error.title}</b>&nbsp;{error.body}</div>}
      {file && !error && (
        <div className="card pad" style={{ boxShadow: "none" }} aria-live="polite">
          <div className="row between">
            <div><div className="t">{file.name}</div><div className="meta">{(file.size / 1048576).toFixed(1)} MB · {file.type || "unknown type"}</div></div>
            {meta ? <span className="pill s-ok">Ready</span> : <button className="btn sm" onClick={cancel}>Cancel</button>}
          </div>
          <div className="bar" style={{ marginTop: 10 }} role="progressbar" aria-valuemin={0} aria-valuemax={CHECKS.length} aria-valuenow={done} aria-label="Validation progress"><i style={{ width: `${(done / CHECKS.length) * 100}%` }} /></div>
          <ul className="list" style={{ marginTop: 8 }}>
            {CHECKS.map((c) => <li key={c} style={{ padding: "6px 0" }}>{icon(checks[c])}<span>{c}</span><span className="meta" style={{ marginLeft: "auto" }}>{checks[c] === "passed" ? "Passed" : checks[c] === "running" ? (c === "Upload" ? `${Math.round(progress * 100)}%` : "Checking…") : checks[c] === "failed" ? "Failed" : "Waiting"}</span></li>)}
          </ul>
          {duplicate && <div className="callout tip" style={{ marginTop: 8 }}><b>Already uploaded.</b>&nbsp;This file matches <Link className="link" href={`/projects/${duplicate.id}`}>{duplicate.title}</Link>. You can still continue to create a separate project.</div>}
          <p className="meta" style={{ margin: "8px 0 0" }}>Stored in your workspace storage area (local disk in this prototype; Azure Blob Storage in production).</p>
          {meta && mediaKind && file && <div style={{ marginTop: 10 }}><TrimSplit file={file} kind={mediaKind} upload={meta} onApplied={setParts} onPending={setCutPending} /></div>}
          {meta && <div className="row" style={{ marginTop: 10 }}>
            <button className="btn primary" disabled={cutPending} onClick={() => setReady(true)} data-testid="upload-continue">{parts.length > 1 ? `Continue with ${parts.length} parts` : "Continue to project details"}</button>
            {cutPending && <span className="meta">Apply the trim or split first, or choose “Use the whole file”.</span>}
          </div>}
        </div>
      )}
    </div>
  );
}

"use client";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { ArrowLeft, ArrowRight, Sparkles } from "lucide-react";
import {
  BUSINESS_FUNCTIONS, CLASSIFICATION_POLICY, CLASSIFICATIONS, DESTINATIONS, LANGUAGES, OUTPUT_TYPES, REGIONS, SOURCE_KINDS, TEMPLATES,
  type Classification, type SourceKind,
} from "@/lib/domain/constants";
import { createProject } from "@/server/actions/projects";
import type { CreateProjectInput } from "@/lib/validation/schemas";

const STEPS = ["Source", "Outputs", "Context", "Template", "Review"] as const;

export interface UploadMeta { fileName: string; mimeType: string; sizeBytes: number; checksum: string; durationSec?: number; storageKey?: string }

export function CreationWizard({ owner, initialSource = "recording", upload, parts = [], initialTemplate, aiLabel }: {
  owner: string; initialSource?: SourceKind; upload?: UploadMeta; initialTemplate?: string; aiLabel: string;
  /** A file split into parts: one project per part, with the same details. */
  parts?: UploadMeta[];
}) {
  const split = parts.length > 1;
  const router = useRouter();
  const [step, setStep] = useState(upload ? 1 : 0);
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [v, setV] = useState<CreateProjectInput>({
    sourceKind: initialSource, outputs: ["video", "guide", "article", "subtitles"],
    title: upload ? upload.fileName.replace(/\.[^.]+$/, "").replace(/ \((trimmed|part \d+ of \d+)\)$/, "").replace(/[-_]+/g, " ") : "", description: "",
    businessFunction: "Retail Operations", processCategory: "", region: "Europe", country: "", sourceSystem: "", audience: "",
    classification: "Internal", smeName: "", approverName: "", primaryLanguage: "en", targetLanguages: ["fr", "it"], destinations: ["sharepoint"],
    reviewFrequencyDays: 180, templateKey: (initialTemplate as CreateProjectInput["templateKey"]) ?? "global", upload,
  });
  const set = <K extends keyof CreateProjectInput>(k: K, val: CreateProjectInput[K]) => setV((x) => ({ ...x, [k]: val }));
  const toggle = <K extends "outputs" | "targetLanguages" | "destinations">(k: K, val: string) =>
    setV((x) => ({ ...x, [k]: (x[k] as string[]).includes(val) ? (x[k] as string[]).filter((y) => y !== val) : [...(x[k] as string[]), val] }));
  const policy = CLASSIFICATION_POLICY[v.classification as Classification];

  function go(n: number) { setStep(n); setFormError(null); requestAnimationFrame(() => heading.current?.focus()); }

  function validateStep(): boolean {
    const e: Record<string, string> = {};
    if (step === 1 && !v.outputs.length) e.outputs = "Choose at least one output.";
    if (step === 2) {
      if (v.title.trim().length < 3) e.title = "Add a title of at least 3 characters. Name the process people will search for.";
      if (!v.processCategory.trim()) e.processCategory = "Add a process category.";
      if (!v.country.trim()) e.country = "Add a country, or “Global”.";
      if (!v.audience.trim()) e.audience = "Describe who this is for.";
      if (v.classification === "Restricted") e.classification = "Restricted content can't be recorded or processed by AI.";
      if (v.targetLanguages.includes(v.primaryLanguage)) e.targetLanguages = "Target languages can't include the primary language.";
      const bad = v.destinations.filter((d) => !policy.destinations.includes(d));
      if (bad.length) e.destinations = `${v.classification} content can't go to ${bad.map((b) => DESTINATIONS.find((d) => d.key === b)?.label).join(", ")}.`;
    }
    setErrors(e);
    if (Object.keys(e).length) { setFormError("Some fields need attention."); requestAnimationFrame(() => document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus()); }
    return !Object.keys(e).length;
  }

  function submit() {
    start(async () => {
      if (split) {
        // One project per part, in order; stop at the first failure and say how far it got.
        let first: string | null = null;
        const group = crypto.randomUUID();
        for (const [i, part] of parts.entries()) {
          const r = await createProject({ ...v, title: `${v.title} (part ${i + 1} of ${parts.length})`.slice(0, 120), upload: part, part: { group, number: i + 1, count: parts.length } });
          if (!r.ok) { setErrors(r.fieldErrors ?? {}); setFormError(`${i ? `${i} of ${parts.length} projects were created. ` : ""}${r.error.message}`); return; }
          first ??= r.data.projectId;
        }
        router.push(`/projects/${first}/processing`);
        return;
      }
      const res = await createProject(v);
      if (res.ok) { router.push(`/projects/${res.data.projectId}/processing`); return; }
      setErrors(res.fieldErrors ?? {});
      setFormError(res.error.message);
      if (res.fieldErrors && Object.keys(res.fieldErrors).some((k) => ["title", "processCategory", "country", "audience", "classification"].includes(k))) go(2);
    });
  }

  const err = (k: string) => errors[k] ? <span className="field-error" id={`${k}-err`}>{errors[k]}</span> : null;
  const text = (k: "title" | "processCategory" | "country" | "sourceSystem" | "audience" | "smeName" | "approverName", label: string, hint?: string) => (
    <label className="f">{label}{hint && <span className="hint">{hint}</span>}
      <input type="text" id={`w_${k}`} value={v[k] ?? ""} onChange={(e) => set(k, e.target.value)} aria-invalid={!!errors[k]} aria-describedby={errors[k] ? `${k}-err` : undefined} />
      {err(k)}
    </label>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 980 }}>
      <ol className="stepper" aria-label="Progress">
        {STEPS.map((s, i) => <li key={s} className={i === step ? "on" : i < step ? "done" : ""} aria-current={i === step ? "step" : undefined}><span className="n">{i < step ? "✓" : i + 1}</span>{s}</li>)}
      </ol>
      {formError && <div className="callout warn" role="alert"><b>{formError}</b></div>}
      <div className="card pad" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <h2 className="sec-h" tabIndex={-1} ref={heading}>{["Choose a source", "Select outputs", "Configure context", "Choose a template", "Review and create"][step]}</h2>

        {step === 0 && (
          <div className="checks" role="radiogroup" aria-label="Source">
            {SOURCE_KINDS.map((k) => (
              <label key={k.key} className="check"><input type="radio" name="src" checked={v.sourceKind === k.key} onChange={() => set("sourceKind", k.key)} /><span>{k.label}<small>{k.hint}</small></span></label>
            ))}
          </div>
        )}

        {step === 1 && (<>
          <p className="meta" style={{ margin: 0 }}>Generated outputs are drafts and need review before publishing.</p>
          <div className="checks">{OUTPUT_TYPES.map((o) => (
            <label key={o.key} className="check"><input type="checkbox" checked={v.outputs.includes(o.key)} onChange={() => toggle("outputs", o.key)} /><span>{o.label}<small>{o.hint}</small></span></label>
          ))}</div>{err("outputs")}
        </>)}

        {step === 2 && (<>
          <div className="grid g2">
            {text("title", "Title *", "Name it the way people will search for it")}
            {text("sourceSystem", "Source system", "Protected from translation and AI rewriting")}
            <label className="f" style={{ gridColumn: "1/-1" }}>Description and process notes<span className="hint">Codex writes the guide from this text plus any uploaded document or transcript. List the steps, systems and warnings.</span>
              <textarea id="w_desc" value={v.description} onChange={(e) => set("description", e.target.value)} maxLength={4000} rows={6} />
            </label>
            <label className="f">Business function<select className="in" id="w_fn" value={v.businessFunction} onChange={(e) => set("businessFunction", e.target.value as CreateProjectInput["businessFunction"])}>{BUSINESS_FUNCTIONS.map((f) => <option key={f}>{f}</option>)}</select></label>
            {text("processCategory", "Process category *")}
            <label className="f">Region<select className="in" id="w_region" value={v.region} onChange={(e) => set("region", e.target.value as CreateProjectInput["region"])}>{REGIONS.map((r) => <option key={r}>{r}</option>)}</select></label>
            {text("country", "Country *")}
            {text("audience", "Intended audience *")}
            <label className="f">Confidentiality classification
              <select className="in" id="w_cls" value={v.classification} onChange={(e) => set("classification", e.target.value as CreateProjectInput["classification"])} aria-invalid={!!errors.classification}>{CLASSIFICATIONS.map((c) => <option key={c}>{c}</option>)}</select>
              {err("classification")}
            </label>
            <label className="f">Content owner<input type="text" id="w_owner" value={owner} readOnly aria-readonly /></label>
            {text("smeName", "Subject-matter expert")}
            {text("approverName", "Approver")}
            <label className="f">Primary language<select className="in" id="w_lang" value={v.primaryLanguage} onChange={(e) => set("primaryLanguage", e.target.value)}>{LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}</select></label>
            <label className="f">Review frequency<select className="in" id="w_freq" value={v.reviewFrequencyDays} onChange={(e) => set("reviewFrequencyDays", Number(e.target.value))}><option value={90}>Every 3 months</option><option value={180}>Every 6 months</option><option value={365}>Every 12 months</option></select></label>
          </div>
          {v.classification === "Restricted" && <div className="callout warn" role="alert"><b>Restricted content can&apos;t be recorded or processed by AI.</b>&nbsp;Choose another classification or contact your workspace administrator.</div>}
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend className="f" style={{ marginBottom: 6, fontWeight: 600 }}>Target languages</legend>
            <div className="row">{LANGUAGES.filter((l) => l.code !== v.primaryLanguage).map((l) => <button type="button" key={l.code} className="chip" aria-pressed={v.targetLanguages.includes(l.code)} onClick={() => toggle("targetLanguages", l.code)}>{l.label}</button>)}</div>{err("targetLanguages")}
          </fieldset>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend className="f" style={{ marginBottom: 6, fontWeight: 600 }}>Publishing destinations</legend>
            <div className="row">{DESTINATIONS.map((d) => { const allowed = policy.destinations.includes(d.key); return <button type="button" key={d.key} className="chip" disabled={!allowed} title={allowed ? undefined : `Not allowed for ${v.classification}`} aria-pressed={v.destinations.includes(d.key)} onClick={() => toggle("destinations", d.key)}>{d.label}</button>; })}</div>{err("destinations")}
          </fieldset>
        </>)}

        {step === 3 && (
          <div className="checks" role="radiogroup" aria-label="Template">
            {TEMPLATES.map((t) => <label key={t.key} className="check"><input type="radio" name="tpl" checked={v.templateKey === t.key} onChange={() => set("templateKey", t.key)} /><span>{t.name}<small>{t.fn}</small></span></label>)}
          </div>
        )}

        {step === 4 && (<>
          <div className="tablewrap"><table><tbody>
            {([
              ["Source", SOURCE_KINDS.find((k) => k.key === v.sourceKind)?.label + (split ? ` · ${parts.length} parts` : upload ? ` · ${upload.fileName}` : "")],
              ...(split ? [["Projects", `${parts.length} projects, one per part: “${v.title} (part 1 of ${parts.length})” and so on`]] : []),
              ["Outputs", v.outputs.map((o) => OUTPUT_TYPES.find((x) => x.key === o)?.label).join(", ")],
              ["Title", v.title], ["Function", `${v.businessFunction} · ${v.processCategory}`], ["Region", `${v.region} · ${v.country}`],
              ["Classification", v.classification], ["Owner / SME / Approver", [owner, v.smeName || "Auto-assign", v.approverName || "Auto-assign"].join(" / ")],
              ["Languages", `${LANGUAGES.find((l) => l.code === v.primaryLanguage)?.label} → ${v.targetLanguages.map((c) => LANGUAGES.find((l) => l.code === c)?.label).join(", ") || "none"}`],
              ["Destinations", v.destinations.map((d) => DESTINATIONS.find((x) => x.key === d)?.label).join(", ") || "Decide later"],
              ["Template", TEMPLATES.find((t) => t.key === v.templateKey)?.name], ["Review frequency", `Every ${v.reviewFrequencyDays / 30} months`],
            ] as [string, string][]).map(([k, val]) => <tr key={k}><th scope="row" style={{ width: 220 }}>{k}</th><td>{val}</td></tr>)}
          </tbody></table></div>
          <div className="callout ai"><b>AI processing:</b>&nbsp;{aiLabel}. Every output is labelled as AI-generated and must be reviewed by a person before it can be published.</div>
        </>)}
      </div>

      <div className="row between">
        <button type="button" className="btn" disabled={step === 0 || pending} onClick={() => go(step - 1)}><ArrowLeft size={16} aria-hidden /> Back</button>
        {step < 4
          ? <button type="button" className="btn primary" onClick={() => validateStep() && go(step + 1)}>Continue <ArrowRight size={16} aria-hidden /></button>
          : <button type="button" className="btn primary" disabled={pending} onClick={submit} data-testid="wizard-create"><Sparkles size={16} aria-hidden /> {pending ? "Creating…" : split ? `Create ${parts.length} projects and start processing` : "Create and start processing"}</button>}
      </div>
    </div>
  );
}

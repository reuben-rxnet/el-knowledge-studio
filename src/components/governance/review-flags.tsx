"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ShieldAlert } from "lucide-react";
import { FLAG_META } from "@/lib/domain/constants";
import { decideReviewFlag } from "@/server/actions/quality";
import { TonePill } from "@/components/common/badges";
import { useToast } from "@/components/common/toast";

export interface FlagView { id: string; kind: string; quote: string; note: string; status: string; stepLabel: string | null }

function FlagItem({ f, canDecide }: { f: FlagView; canDecide: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const meta = FLAG_META[f.kind] ?? { label: f.kind, tone: "neutral" as const };
  const decide = (decision: "resolved" | "dismissed") => start(async () => {
    const r = await decideReviewFlag({ flagId: f.id, decision, note });
    if (!r.ok) { setErr(r.error.message); return; }
    toast(decision === "resolved" ? "Flag resolved. Your note was added to the comments." : "Flag dismissed. Your note was added to the comments.");
    router.refresh();
  });
  return (
    <li className="para" style={{ opacity: f.status === "open" ? 1 : 0.6 }}>
      <div className="row between">
        <div className="row" style={{ gap: 8 }}><TonePill tone={meta.tone}>{meta.label}</TonePill>{f.stepLabel && <span className="meta">{f.stepLabel}</span>}</div>
        {f.status !== "open" && <TonePill tone="ok">{f.status === "resolved" ? "Resolved" : "Dismissed"}</TonePill>}
      </div>
      <blockquote style={{ margin: 0, paddingLeft: 10, borderLeft: "3px solid var(--border)" }}>“{f.quote}”</blockquote>
      <span className="meta" style={{ fontSize: 13 }}>{f.note}</span>
      {f.status === "open" && canDecide && (open ? (
        <div style={{ display: "grid", gap: 8 }}>
          <label className="f">Your note<span className="hint">What you changed, or why this is fine as written</span><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} aria-invalid={!!err} /></label>
          {err && <span className="field-error" role="alert">{err}</span>}
          <div className="row"><button className="btn sm primary" disabled={pending} onClick={() => decide("resolved")}>Resolved</button><button className="btn sm" disabled={pending} onClick={() => decide("dismissed")}>Not an issue</button><button className="btn sm ghost" onClick={() => setOpen(false)}>Cancel</button></div>
        </div>
      ) : <button className="btn sm" style={{ justifySelf: "start" }} onClick={() => setOpen(true)}>Decide</button>)}
    </li>
  );
}

export function ReviewFlagsPanel({ flags, canDecide }: { flags: FlagView[]; canDecide: boolean }) {
  const open = flags.filter((f) => f.status === "open");
  const blocking = open.filter((f) => f.kind === "risky" || f.kind === "contradiction").length;
  return (
    <div className="card pad">
      <div className="row between">
        <h2 className="card-h"><ShieldAlert size={16} aria-hidden /> AI review suggestions</h2>
        <span className="meta">{open.length} open</span>
      </div>
      <p className="meta" style={{ margin: "4px 0 10px" }}>The AI never changes the procedure. It flags source statements an SME should check. {blocking ? <b style={{ color: "var(--error)" }}>{blocking} risky or contradictory statement(s) must be decided before approval.</b> : null}</p>
      {flags.length ? <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>{flags.map((f) => <FlagItem key={f.id} f={f} canDecide={canDecide} />)}</ul>
        : <p className="meta" style={{ margin: 0 }}>Nothing flagged. The AI found no risky, ambiguous or contradictory statements in the source.</p>}
    </div>
  );
}

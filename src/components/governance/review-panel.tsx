"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { addComment, decideReview, resolveComment } from "@/server/actions/review";
import { useToast } from "@/components/common/toast";

interface Comment { id: string; author: string; initials: string; body: string; anchor: string; version: number; at: string; resolved: boolean }
interface Anchor { value: string; label: string; type: "project" | "step" | "scene"; ref?: string; ts?: number }

export function CommentThread({ projectId, comments, anchors, canComment }: { projectId: string; comments: Comment[]; anchors: Anchor[]; canComment: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [body, setBody] = useState("");
  const [anchor, setAnchor] = useState(anchors[0]?.value ?? "project");
  const [error, setError] = useState<string | null>(null);

  function post() {
    const a = anchors.find((x) => x.value === anchor) ?? anchors[0]!;
    if (!body.trim()) { setError("Write a comment first."); return; }
    start(async () => {
      const r = await addComment({ projectId, body, anchorType: a.type, anchorRef: a.ref, anchorLabel: a.label, timestampSec: a.ts });
      if (!r.ok) { setError(r.error.message); return; }
      setBody(""); setError(null);
      toast(/@\p{L}+/u.test(body) ? "Comment added. Mentioned colleagues were notified." : "Comment added.");
      router.refresh();
    });
  }

  return (
    <div className="card pad">
      <div className="row between"><h2 className="card-h">Comments</h2><span className="meta">{comments.filter((c) => !c.resolved).length} open</span></div>
      <div style={{ marginTop: 8 }}>
        {comments.length ? comments.map((c) => (
          <div key={c.id} className="comment" style={c.resolved ? { opacity: 0.55 } : undefined}>
            <span className="avatar" aria-hidden>{c.initials}</span>
            <div style={{ flex: 1 }}>
              <div className="row" style={{ gap: 8 }}><b>{c.author}</b><span className="chip" style={{ padding: "1px 8px" }}>{c.anchor}</span><span className="meta">v{c.version} · {c.at}</span>{c.resolved && <span className="pill s-ok">Resolved</span>}</div>
              <p style={{ margin: "4px 0" }}>{c.body}</p>
              {!c.resolved && canComment && <button className="btn sm ghost" disabled={pending} onClick={() => start(async () => { const r = await resolveComment({ commentId: c.id }); if (r.ok) router.refresh(); else setError(r.error.message); })}>Resolve</button>}
            </div>
          </div>
        )) : <p className="meta">No comments yet. Comment on a step or a moment in the video, and mention a colleague with @.</p>}
      </div>
      {canComment && (
        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          <label className="f">Comment on<select className="in" id="cAnchor" value={anchor} onChange={(e) => setAnchor(e.target.value)}>{anchors.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</select></label>
          <label className="f">Comment<textarea id="cBody" value={body} onChange={(e) => setBody(e.target.value)} placeholder="e.g. @Amara the threshold in Step 3 differs for France" aria-invalid={!!error} /></label>
          {error && <span className="field-error" role="alert">{error}</span>}
          <button className="btn primary" style={{ justifySelf: "start" }} disabled={pending} onClick={post} data-testid="add-comment">Add comment</button>
        </div>
      )}
    </div>
  );
}

export function DecisionPanel({ review, version, stageLabel }: { review: { id: string; version: number }; version: number; stageLabel: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [just, setJust] = useState("");
  const [error, setError] = useState<string | null>(null);

  function decide(decision: "approve" | "request-changes") {
    if (decision === "request-changes" && just.trim().length < 5) { setError("Explain what needs to change so the creator can act on it."); return; }
    start(async () => {
      const r = await decideReview({ reviewId: review.id, expectedVersion: version, decision, justification: just });
      if (!r.ok) { setError(r.error.message); return; }
      toast(decision === "request-changes" ? "Changes requested. The creator was notified." : r.data.status === "approved" ? `Version ${version} approved. It can now be published.` : "SME review approved. Sent to the approver.");
      router.refresh();
    });
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <p className="meta" style={{ margin: 0 }}>{stageLabel} for version {review.version}. Your decision applies to this version only.</p>
      <label className="f">Justification<span className="hint">Required when requesting changes</span><textarea id="just" value={just} onChange={(e) => setJust(e.target.value)} aria-invalid={!!error} /></label>
      {error && <span className="field-error" role="alert">{error}</span>}
      <div className="row">
        <button className="btn primary" disabled={pending} onClick={() => decide("approve")} data-testid="approve"><Check size={16} aria-hidden /> Approve v{review.version}</button>
        <button className="btn danger" disabled={pending} onClick={() => decide("request-changes")}>Request changes</button>
      </div>
    </div>
  );
}

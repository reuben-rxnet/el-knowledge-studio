"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Send } from "lucide-react";
import { FEEDBACK_CATEGORIES, FEEDBACK_META } from "@/lib/domain/constants";
import { setFeedbackStatus, submitFeedback } from "@/server/actions/feedback";
import { useToast } from "@/components/common/toast";

export function FeedbackForm({ workspace }: { workspace: string }) {
  const router = useRouter();
  const toast = useToast();
  const [category, setCategory] = useState<(typeof FEEDBACK_CATEGORIES)[number]>("problem");
  const [message, setMessage] = useState("");
  const [page, setPage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function send() {
    start(async () => {
      const r = await submitFeedback({ category, message, page });
      if (!r.ok) { setError(r.fieldErrors?.message ?? r.error.message); return; }
      setError(null);
      setMessage("");
      setPage("");
      toast(`Thanks. Your feedback was sent to the ${workspace} administrators.`);
      router.refresh();
    });
  }

  return (
    <div className="card pad" style={{ display: "grid", gap: 12 }}>
      <h2 className="card-h">Send feedback</h2>
      <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
        <legend className="f" style={{ marginBottom: 6 }}>What kind of feedback?</legend>
        <div className="checks">
          {FEEDBACK_CATEGORIES.map((c) => (
            <label key={c} className="check">
              <input type="radio" name="category" value={c} checked={category === c} onChange={() => setCategory(c)} data-testid={`fb-${c}`} />
              <span>{FEEDBACK_META[c].label}<small>{FEEDBACK_META[c].hint}</small></span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="f">Your feedback *
        <textarea className="in" rows={5} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What happened, or what would help? Don't include passwords or customer data." />
      </label>
      <label className="f">Where in the app? (optional)
        <input type="text" maxLength={200} value={page} onChange={(e) => setPage(e.target.value)} placeholder="For example: Review tab, recording a screen" />
      </label>
      {error && <div className="callout warn" role="alert"><b>{error}</b></div>}
      <button className="btn primary" style={{ justifySelf: "start" }} disabled={pending || !message.trim()} onClick={send} data-testid="fb-send">
        <Send size={16} aria-hidden /> {pending ? "Sending…" : "Send feedback"}
      </button>
    </div>
  );
}

export function FeedbackStatus({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <select className="in" aria-label="Status" value={status} disabled={pending} style={{ width: "auto" }}
      onChange={(e) => {
        const next = e.target.value as "new" | "triaged" | "done";
        start(async () => {
          const r = await setFeedbackStatus({ id, status: next });
          if (!r.ok) toast(r.error.message); else router.refresh();
        });
      }}>
      <option value="new">New</option>
      <option value="triaged">Triaged</option>
      <option value="done">Done</option>
    </select>
  );
}

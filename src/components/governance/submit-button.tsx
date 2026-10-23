"use client";
import { useState, useTransition } from "react";
import { Send } from "lucide-react";
import { submitForReview } from "@/server/actions/review";
import { useToast } from "@/components/common/toast";

export function SubmitForReviewButton({ projectId, version }: { projectId: string; version: number }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button className="btn primary" disabled={pending} data-testid="submit-review"
        onClick={() => start(async () => {
          const r = await submitForReview({ projectId, expectedVersion: version });
          if (r.ok) toast("Submitted for SME review. The reviewer was notified.");
          else setErr(r.error.message);
        })}>
        <Send size={16} aria-hidden /> {pending ? "Submitting…" : "Submit for review"}
      </button>
      {err && <span className="field-error" role="alert">{err}</span>}
    </span>
  );
}

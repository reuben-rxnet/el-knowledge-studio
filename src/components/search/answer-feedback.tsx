"use client";
import { useState, useTransition } from "react";
import { Flag, ThumbsUp } from "lucide-react";
import { rateAnswer } from "@/server/actions/search";

export function AnswerFeedback({ query }: { query: string }) {
  const [done, setDone] = useState<null | "up" | "down">(null);
  const [pending, start] = useTransition();
  if (done) return <p className="meta" role="status" style={{ margin: 0 }}>{done === "up" ? "Thanks. Your rating was recorded." : "Reported. The content owners will review this answer."}</p>;
  return (
    <div className="row">
      <button className="btn sm ghost" disabled={pending} onClick={() => start(async () => { const r = await rateAnswer({ query, helpful: true }); if (r.ok) setDone("up"); })}><ThumbsUp size={13} aria-hidden /> Helpful</button>
      <button className="btn sm ghost" disabled={pending} onClick={() => start(async () => { const r = await rateAnswer({ query, helpful: false, reason: "reported-incorrect" }); if (r.ok) setDone("down"); })}><Flag size={13} aria-hidden /> Report an incorrect answer</button>
    </div>
  );
}

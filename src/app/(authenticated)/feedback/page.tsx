import type { Metadata } from "next";
import { MessageSquare } from "lucide-react";
import { requirePageSession } from "@/lib/auth/session";
import { db } from "@/lib/database/client";
import { FEEDBACK_META, type FEEDBACK_CATEGORIES } from "@/lib/domain/constants";
import { relativeTime } from "@/lib/utilities/format";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { FeedbackForm, FeedbackStatus } from "@/components/governance/feedback-form";

export const metadata: Metadata = { title: "Feedback" };
const label = (c: string) => FEEDBACK_META[c as (typeof FEEDBACK_CATEGORIES)[number]]?.label ?? c;
const STATUS_LABEL: Record<string, string> = { new: "New", triaged: "Triaged", done: "Done" };

/** Pilot feedback: everyone can send; workspace administrators see and triage the workspace's feedback. */
export default async function FeedbackPage() {
  const s = await requirePageSession();
  const triage = s.permissions.has("workspace.manage");
  const items = await db.feedbackItem.findMany({
    where: triage ? { workspaceId: s.workspace.id } : { workspaceId: s.workspace.id, userId: s.user.id },
    orderBy: { createdAt: "desc" }, take: 100,
  });
  const people = triage ? new Map((await db.user.findMany({ where: { id: { in: [...new Set(items.map((i) => i.userId))] } }, select: { id: true, displayName: true } })).map((u) => [u.id, u.displayName])) : null;

  return (
    <section style={{ maxWidth: 900, display: "grid", gap: 16 }}>
      <PageHeader title="Feedback" subtitle="Tell the product team what works and what doesn't." />
      <FeedbackForm workspace={s.workspace.name} />
      <div className="card">
        <div className="pad"><h2 className="card-h">{triage ? `Feedback in ${s.workspace.name}` : "Your feedback"}</h2></div>
        {items.length ? (
          <ul className="list">{items.map((i) => (
            <li key={i.id}>
              <div style={{ flex: 1 }}>
                <div className="t">{label(i.category)}{i.page ? ` · ${i.page}` : ""}</div>
                <p style={{ margin: "4px 0", whiteSpace: "pre-wrap" }}>{i.message}</p>
                <div className="meta">{people ? `${people.get(i.userId) ?? "Unknown user"} · ` : ""}{relativeTime(i.createdAt)}</div>
              </div>
              {triage ? <FeedbackStatus id={i.id} status={i.status} /> : <span className="meta">{STATUS_LABEL[i.status] ?? i.status}</span>}
            </li>
          ))}</ul>
        ) : <EmptyState icon={MessageSquare} title="No feedback yet">{triage ? "Feedback sent from this workspace appears here." : "Feedback you send appears here, with its status."}</EmptyState>}
      </div>
    </section>
  );
}

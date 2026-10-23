import Link from "next/link";
import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { requirePageSession } from "@/lib/auth/session";
import { db } from "@/lib/database/client";
import { relativeTime } from "@/lib/utilities/format";
import { TonePill } from "@/components/common/badges";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Thumb } from "@/components/common/thumb";

export const metadata: Metadata = { title: "Reviews" };
const FILTERS: [string, string][] = [["mine", "Assigned to me"], ["sme", "Awaiting SME review"], ["approval", "Approval pending"], ["changes", "Changes requested"], ["overdue", "Overdue"], ["done", "Completed"], ["all", "All"]];

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const s = await requirePageSession();
  const { f = "mine" } = await searchParams;
  const now = new Date();
  const where = {
    project: { workspaceId: s.workspace.id },
    ...(f === "mine" ? { assigneeId: s.user.id, status: "open" } : {}),
    ...(f === "sme" ? { stage: "sme", status: "open" } : {}),
    ...(f === "approval" ? { stage: "approval", status: "open" } : {}),
    ...(f === "changes" ? { status: "changes-requested" } : {}),
    ...(f === "overdue" ? { status: "open", dueAt: { lt: now } } : {}),
    ...(f === "done" ? { status: "approved" } : {}),
    ...(f === "all" ? { status: { not: "superseded" } } : {}),
  };
  const rows = await db.reviewRequest.findMany({ where, include: { project: true, assignee: true }, orderBy: { dueAt: "asc" }, take: 100 });

  return (
    <section>
      <PageHeader title="Reviews" subtitle="Every decision is bound to one version and recorded in the audit history." />
      <nav aria-label="Filter reviews" className="row">{FILTERS.map(([k, l]) => <Link key={k} className="chip" aria-current={(f === k) ? "page" : undefined} href={`/reviews?f=${k}`}>{l}</Link>)}</nav>
      <div className="card">
        {rows.length ? (
          <ul className="list">{rows.map((r) => {
            const overdue = r.status === "open" && r.dueAt < now;
            return (
              <li key={r.id} className="clickable">
                <Thumb hue={r.project.hue} />
                <Link href={`/projects/${r.projectId}/review`} style={{ flex: 1 }}>
                  <span className="t" style={{ display: "block" }}>{r.project.title}</span>
                  <span className="meta">{r.stage === "sme" ? "SME review" : "Approval"} · version {r.version} · assigned to {r.assignee.displayName}</span>
                </Link>
                {r.status === "open" ? <TonePill tone={overdue ? "err" : "warn"}>{overdue ? `Overdue · due ${relativeTime(r.dueAt)}` : `Due ${relativeTime(r.dueAt)}`}</TonePill>
                  : r.status === "changes-requested" ? <TonePill tone="err">Changes requested</TonePill> : <TonePill tone="ok">Approved</TonePill>}
              </li>
            );
          })}</ul>
        ) : (
          <EmptyState icon={CheckCircle2} title={f === "mine" ? "Your review inbox is clear" : "No reviews match this filter"} action={f !== "all" ? <Link className="chip" href="/reviews?f=all">Show all reviews</Link> : undefined}>
            New review requests appear here with their stage, version and due date.
          </EmptyState>
        )}
      </div>
    </section>
  );
}

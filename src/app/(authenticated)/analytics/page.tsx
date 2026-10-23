import Link from "next/link";
import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { requirePageSession } from "@/lib/auth/session";
import { db } from "@/lib/database/client";
import { freshnessOf } from "@/lib/domain/constants";
import { formatNumber } from "@/lib/utilities/format";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";

export const metadata: Metadata = { title: "Analytics" };

function averageAgeDays(dates: Date[], now = new Date()) {
  if (!dates.length) return 0;
  return Math.round(dates.reduce((n, d) => n + (now.getTime() - d.getTime()) / 86_400_000, 0) / dates.length);
}

function Bars({ rows, label }: { rows: [string, number][]; label: string }) {
  const max = Math.max(1, ...rows.map(([, v]) => v));
  return (
    <div role="list" aria-label={label} style={{ marginTop: 10 }}>
      {rows.map(([k, v]) => (
        <div key={k} className="hbar" role="listitem" aria-label={`${k}: ${formatNumber(v)}`}>
          <span>{k}</span><span className="track2" aria-hidden><i style={{ width: `${(v / max) * 100}%` }} /></span><span className="val">{formatNumber(v)}</span>
        </div>
      ))}
    </div>
  );
}

export default async function AnalyticsPage() {
  const s = await requirePageSession();
  if (!s.permissions.has("analytics.view")) {
    return <section><div className="card"><EmptyState icon={Lock} title="You don't have access to analytics" action={<Link className="btn" href="/">Back to Home</Link>}>Analytics needs the analytics.view permission (Approver, Publisher, Auditor or an administrator).</EmptyState></div></section>;
  }
  const [projects, pubs, feedback, translations] = await Promise.all([
    db.project.findMany({ where: { workspaceId: s.workspace.id, deletedAt: null } }),
    db.publishingJob.groupBy({ by: ["destination"], where: { project: { workspaceId: s.workspace.id } }, _count: true }),
    db.searchFeedback.findMany({ select: { helpful: true, query: true } }),
    db.translationProject.groupBy({ by: ["language"], where: { project: { workspaceId: s.workspace.id } }, _count: true }),
  ]);
  const byFn = Object.entries(projects.reduce<Record<string, number>>((a, p) => ((a[p.businessFunction] = (a[p.businessFunction] ?? 0) + 1), a), {})).sort((a, b) => b[1] - a[1]);
  const topViewed = [...projects].sort((a, b) => b.views - a.views).slice(0, 5).map((p) => [p.title, p.views] as [string, number]);
  const fresh = projects.reduce<Record<string, number>>((a, p) => { const f = freshnessOf(p.nextReviewAt, p.status); a[f] = (a[f] ?? 0) + 1; return a; }, {});
  const views = projects.reduce((n, p) => n + p.views, 0);
  const avgAge = averageAgeDays(projects.map((p) => p.createdAt));
  const failed = feedback.filter((f) => !f.helpful);

  return (
    <section>
      <PageHeader title="Analytics" subtitle="Content effectiveness and adoption. Aggregated only: no individual viewing data, productivity scores or sentiment inference." />
      <div className="grid g4">
        {([["Total views", formatNumber(views)], ["Published items", formatNumber(projects.filter((p) => p.publishedVersion).length)], ["Average content age", `${avgAge} days`], ["Answer ratings", feedback.length ? `${Math.round(((feedback.length - failed.length) / feedback.length) * 100)}% helpful` : "No ratings yet"]] as [string, string][]).map(([l, v]) => (
          <div key={l} className="card kpi"><span className="meta">{l}</span><span className="v">{v}</span></div>
        ))}
      </div>
      <div className="grid g2">
        <figure className="card pad" style={{ margin: 0 }}><figcaption className="card-h">Content by function</figcaption><Bars rows={byFn} label="Projects by business function" /><p className="meta">{byFn[0] ? `${byFn[0][0]} has the most content (${byFn[0][1]}).` : "No content yet."}</p></figure>
        <figure className="card pad" style={{ margin: 0 }}><figcaption className="card-h">Most-viewed content</figcaption><Bars rows={topViewed} label="Views per project" /></figure>
        <figure className="card pad" style={{ margin: 0 }}><figcaption className="card-h">Content freshness</figcaption><Bars rows={[["Current", fresh.current ?? 0], ["Review due soon", fresh["due-soon"] ?? 0], ["Review overdue", fresh.overdue ?? 0], ["Expired", fresh.expired ?? 0]]} label="Projects by freshness status" /></figure>
        <figure className="card pad" style={{ margin: 0 }}><figcaption className="card-h">Publishing destinations</figcaption><Bars rows={pubs.map((p) => [p.destination, p._count] as [string, number])} label="Publications per destination" /></figure>
        <figure className="card pad" style={{ margin: 0 }}><figcaption className="card-h">Translation coverage</figcaption><Bars rows={translations.map((t) => [t.language.toUpperCase(), t._count] as [string, number])} label="Translations per language" /></figure>
        <figure className="card pad" style={{ margin: 0 }}><figcaption className="card-h">Search gaps</figcaption>
          {failed.length ? <ul>{failed.slice(0, 6).map((f, i) => <li key={i}>{f.query}</li>)}</ul> : <p className="meta">No answers have been reported as incorrect yet. Reported questions appear here so owners can fill the gaps.</p>}
        </figure>
      </div>
    </section>
  );
}

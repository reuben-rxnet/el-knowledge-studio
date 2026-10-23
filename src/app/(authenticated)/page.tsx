import Link from "next/link";
import { ArrowRight, CheckCircle2, Disc, Globe2, Sparkles, Upload } from "lucide-react";
import { requirePageSession } from "@/lib/auth/session";
import { db } from "@/lib/database/client";
import { csv, freshnessOf } from "@/lib/domain/constants";
import { formatNumber, relativeTime } from "@/lib/utilities/format";
import { StatusPill } from "@/components/common/badges";
import { EmptyState } from "@/components/common/empty-state";
import { LensArt } from "@/components/common/lens-art";
import { Thumb } from "@/components/common/thumb";

export default async function HomePage() {
  const s = await requirePageSession();
  const ws = s.workspace.id;
  const [projects, myReviews, published, translations, decided, feedback, activity] = await Promise.all([
    db.project.findMany({ where: { workspaceId: ws, deletedAt: null }, orderBy: { updatedAt: "desc" } }),
    db.reviewRequest.findMany({ where: { assigneeId: s.user.id, status: "open", project: { workspaceId: ws } }, include: { project: true }, orderBy: { dueAt: "asc" } }),
    db.publishingJob.count({ where: { status: "succeeded", project: { workspaceId: ws } } }),
    db.translationProject.findMany({ where: { project: { workspaceId: ws } } }),
    db.reviewRequest.findMany({ where: { decidedAt: { not: null }, project: { workspaceId: ws } }, select: { createdAt: true, decidedAt: true } }),
    db.searchFeedback.findMany({ select: { helpful: true } }),
    db.auditEvent.findMany({ where: { workspaceId: ws, outcome: "success" }, orderBy: { occurredAt: "desc" }, take: 5 }),
  ]);

  const targets = projects.reduce((n, p) => n + csv(p.targetLanguages).length, 0);
  const approvedTr = translations.filter((t) => t.status === "approved").length;
  const current = projects.filter((p) => freshnessOf(p.nextReviewAt, p.status) === "current").length;
  const turnaround = decided.length ? decided.reduce((n, r) => n + (r.decidedAt!.getTime() - r.createdAt.getTime()), 0) / decided.length / 86_400_000 : null;
  const watchHours = projects.reduce((n, p) => n + (p.views * p.durationSec * 0.7) / 3600, 0);
  const kpis: [string, string, string][] = [
    ["Content created", formatNumber(projects.length), "In this workspace"],
    ["Published assets", formatNumber(published), "Across all destinations"],
    ["Hours of viewing", formatNumber(Math.round(watchHours)), "Estimated from views × 70% completion"],
    ["Estimated hours saved", formatNumber(Math.round(watchHours * 0.4)), "Assumption: 0.4 h saved per viewing hour"],
    ["Translation coverage", targets ? `${Math.round((approvedTr / targets) * 100)}%` : "—", `${approvedTr} of ${targets} target languages approved`],
    ["Content freshness", projects.length ? `${Math.round((current / projects.length) * 100)}%` : "—", `${projects.length - current} items need review`],
    ["Approval turnaround", turnaround === null ? "—" : `${turnaround.toFixed(1)} days`, "Average, last decisions"],
    ["Search success rate", feedback.length ? `${Math.round((feedback.filter((f) => f.helpful).length / feedback.length) * 100)}%` : "—", feedback.length ? `${feedback.length} ratings` : "No answer ratings yet"],
  ];
  const continueWorking = projects.filter((p) => ["ai-generated", "creator-review", "changes-requested", "draft", "processing"].includes(p.status)).slice(0, 4);
  const trending = projects.filter((p) => p.publishedVersion).sort((a, b) => b.views - a.views).slice(0, 4);
  const hour = new Date().getHours();

  return (
    <section>
      <div className="hero">
        <div>
          <div className="tag">Capture once. Share knowledge everywhere.</div>
          <h1 style={{ marginTop: 10 }}>Turn expertise into knowledge everyone can use</h1>
          <p>Record a process or upload existing content. EL Knowledge Studio creates professional videos, guides, translations, and learning materials automatically.</p>
          <div className="row">
            {s.permissions.has("project.create") && <>
              <Link className="btn primary" href="/create/record"><Disc size={16} aria-hidden /> Start recording</Link>
              <Link className="btn" href="/create/upload"><Upload size={16} aria-hidden /> Upload content</Link>
            </>}
            {projects[0] && <Link className="btn ghost" style={{ color: "#C8D7EA" }} href={`/projects/${projects[0].id}`}>Explore a sample project <ArrowRight size={16} aria-hidden /></Link>}
          </div>
        </div>
        <div className="art"><LensArt /></div>
      </div>

      <div className="row between">
        <div>
          <h2 className="sec-h">Good {hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"}, {s.user.displayName.split(" ")[0]}</h2>
          <p className="meta" style={{ margin: "2px 0 0" }}>{s.workspace.name}</p>
        </div>
        <span className="meta">Workspace insights</span>
      </div>

      <div className="grid g4">
        {kpis.map(([label, value, note]) => (
          <div key={label} className="card kpi"><span className="meta">{label}</span><span className="v">{value}</span><span className="meta">{note}</span></div>
        ))}
      </div>

      <div className="split">
        <div className="card">
          <div className="pad row between"><h3 className="card-h">Continue working</h3><Link className="btn sm ghost" href="/projects?scope=mine">View all</Link></div>
          {continueWorking.length ? (
            <ul className="list">{continueWorking.map((p) => (
              <li key={p.id} className="clickable">
                <Thumb hue={p.hue} />
                <Link href={`/projects/${p.id}`} style={{ flex: 1, minWidth: 0 }}><span className="t" style={{ display: "block" }}>{p.title}</span><span className="meta">{p.businessFunction} · v{p.currentVersion} · updated {relativeTime(p.updatedAt)}</span></Link>
                <StatusPill status={p.status} />
              </li>
            ))}</ul>
          ) : <EmptyState icon={Sparkles} title="Nothing in progress" action={s.permissions.has("project.create") ? <Link className="btn sm" href="/create">Create content</Link> : undefined}>Drafts you&apos;re working on appear here, so you can pick up where you left off.</EmptyState>}
        </div>
        <div className="card">
          <div className="pad row between"><h3 className="card-h">Review inbox</h3><span className="pill s-info">{myReviews.length} assigned to you</span></div>
          {myReviews.length ? (
            <ul className="list">{myReviews.map((r) => (
              <li key={r.id} className="clickable">
                <Link href={`/projects/${r.projectId}/review`} style={{ flex: 1 }}><span className="t" style={{ display: "block" }}>{r.project.title}</span><span className="meta">{r.stage.toUpperCase()} review · version {r.version} · due {relativeTime(r.dueAt)}</span></Link>
                <ArrowRight size={16} aria-hidden />
              </li>
            ))}</ul>
          ) : <EmptyState icon={CheckCircle2} title="Nothing waiting for you">When someone asks you to review content, it appears here with its due date and version.</EmptyState>}
        </div>
      </div>

      <div className="grid g3">
        <div className="card">
          <div className="pad"><h3 className="card-h">Recent activity</h3></div>
          <ul className="list">{activity.map((a) => (
            <li key={a.id}><Sparkles size={16} aria-hidden /><div><div><b>{a.actorName}</b> · {a.action.replace(".", " ")}</div><div className="meta">{a.resourceLabel} · {relativeTime(a.occurredAt)}</div></div></li>
          ))}</ul>
        </div>
        <div className="card">
          <div className="pad"><h3 className="card-h">Trending in your workspace</h3></div>
          {trending.length ? <ul className="list">{trending.map((p, i) => (
            <li key={p.id} className="clickable"><span className="meta" style={{ width: 14 }}>{i + 1}</span><Link href={`/projects/${p.id}`} style={{ flex: 1 }}><span className="t" style={{ display: "block" }}>{p.title}</span><span className="meta">{formatNumber(p.views)} views · {p.businessFunction}</span></Link></li>
          ))}</ul> : <EmptyState icon={Globe2} title="Nothing published yet">Published content shows here once people start viewing it.</EmptyState>}
        </div>
        <div className="card pad" style={{ display: "grid", gap: 10, alignContent: "start" }}>
          <h3 className="card-h">Recommended templates</h3>
          {["Retail store procedure", "IT application tutorial", "Learning module"].map((t) => <Link key={t} className="chip" href="/templates">{t}</Link>)}
          <p className="meta" style={{ margin: 0 }}>Templates bring the right outputs, approval flow and branding for your function.</p>
        </div>
      </div>
    </section>
  );
}

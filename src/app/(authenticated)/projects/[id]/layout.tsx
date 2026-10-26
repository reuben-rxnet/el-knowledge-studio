import Link from "next/link";
import { ChevronLeft, ChevronRight, CheckCircle2, Network, Send } from "lucide-react";
import { requirePageSession } from "@/lib/auth/session";
import { db } from "@/lib/database/client";
import { freshnessOf } from "@/lib/domain/constants";
import { formatDate, relativeTime } from "@/lib/utilities/format";
import { getProjectOr404 } from "@/server/queries";
import { studioEnabled } from "@/server/studio";
import { ClassificationTag, FreshnessPill, StatusPill } from "@/components/common/badges";
import { Thumb } from "@/components/common/thumb";
import { ProjectTabs } from "@/components/content/project-tabs";
import { SubmitForReviewButton } from "@/components/governance/submit-button";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const s = await requirePageSession();
  const { id } = await params;
  const p = await getProjectOr404(s, id);
  const [openComments, parts] = await Promise.all([
    db.comment.count({ where: { projectId: p.id, resolvedAt: null } }),
    // The other parts of the same split upload, in order (only those still in this workspace).
    p.partGroup ? db.project.findMany({ where: { partGroup: p.partGroup, workspaceId: s.workspace.id, deletedAt: null }, orderBy: { partNumber: "asc" }, select: { id: true, partNumber: true, title: true } }) : Promise.resolve([]),
  ]);
  const at = parts.findIndex((x) => x.id === p.id);
  const prev = at > 0 ? parts[at - 1] : null;
  const next = at >= 0 && at < parts.length - 1 ? parts[at + 1] : null;
  const canSubmit = s.permissions.has("project.edit") && ["ai-generated", "creator-review", "changes-requested", "draft"].includes(p.status);

  return (
    <section>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <nav aria-label="Breadcrumb" className="crumbs-nav"><ol><li><Link href="/projects">Team Library</Link></li><li><span aria-current="page">{p.title}</span></li></ol></nav>
        <div className="row" style={{ gap: 16, alignItems: "flex-start", flexWrap: "nowrap" }}>
          <Thumb hue={p.hue} width={96} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="row" style={{ gap: 8 }}>
              <StatusPill status={p.status} /><ClassificationTag value={p.classification} /><FreshnessPill status={freshnessOf(p.nextReviewAt, p.status)} />
              <span className="meta">Version {p.currentVersion}{p.approvedVersion ? ` · v${p.approvedVersion} approved` : ""}{p.publishedVersion ? ` · v${p.publishedVersion} published` : ""}</span>
            </div>
            <h1 className="page-title" style={{ marginTop: 6 }}>{p.title}</h1>
            {parts.length > 1 && (
              <nav aria-label="Parts of this recording" className="row" style={{ gap: 6, flexWrap: "wrap", margin: "6px 0" }} data-testid="parts-nav">
                <span className="meta">Part {p.partNumber} of {p.partCount}</span>
                {prev ? <Link className="btn sm" href={`/projects/${prev.id}`}><ChevronLeft size={14} aria-hidden /> Part {prev.partNumber}</Link> : null}
                {parts.map((x) => x.id === p.id
                  ? <span key={x.id} className="chip" aria-current="page" aria-pressed="true">{x.partNumber}</span>
                  : <Link key={x.id} className="chip" href={`/projects/${x.id}`} title={x.title} aria-label={`Part ${x.partNumber}: ${x.title}`}>{x.partNumber}</Link>)}
                {next ? <Link className="btn sm" href={`/projects/${next.id}`}>Part {next.partNumber} <ChevronRight size={14} aria-hidden /></Link> : null}
              </nav>
            )}
            <div className="meta">{s.workspace.name.startsWith(p.businessFunction) ? s.workspace.name : `${p.businessFunction} · ${s.workspace.name}`} · Owner {p.owner.displayName} · Updated {relativeTime(p.updatedAt)}{p.nextReviewAt ? ` · Next review ${formatDate(p.nextReviewAt)}` : ""}</div>
          </div>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            {canSubmit && <SubmitForReviewButton projectId={p.id} version={p.currentVersion} />}
            {["sme-review", "approval-pending", "compliance-review"].includes(p.status) && <Link className="btn primary" href={`/projects/${p.id}/review`}><CheckCircle2 size={16} aria-hidden /> Open review</Link>}
            {p.status === "approved" && s.permissions.has("publish.execute") && <Link className="btn primary" href={`/projects/${p.id}/publishing`}><Send size={16} aria-hidden /> Publish</Link>}
            {p.publishedVersion && <Link className="btn" href={`/knowledge?q=${encodeURIComponent(p.title)}`}><Network size={16} aria-hidden /> View in Knowledge Hub</Link>}
          </div>
        </div>
        <ProjectTabs projectId={p.id} openComments={openComments} studio={s.permissions.has("project.edit") && (await studioEnabled())} />
      </div>
      {children}
    </section>
  );
}

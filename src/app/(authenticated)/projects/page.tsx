import Link from "next/link";
import type { Metadata } from "next";
import { Folder, Plus } from "lucide-react";
import { requirePageSession } from "@/lib/auth/session";
import { csv, freshnessOf, PROJECT_STATUSES } from "@/lib/domain/constants";
import { relativeTime } from "@/lib/utilities/format";
import { listProjects } from "@/server/queries";
import { ClassificationTag, FreshnessPill, StatusPill } from "@/components/common/badges";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Thumb } from "@/components/common/thumb";

export const metadata: Metadata = { title: "Library" };

const FILTERS: [string, string][] = [["", "All"], ["ai-generated", "AI generated"], ["sme-review", "In SME review"], ["approval-pending", "Approval pending"], ["changes-requested", "Changes requested"], ["approved", "Approved"], ["published", "Published"]];

export default async function LibraryPage({ searchParams }: { searchParams: Promise<{ scope?: string; status?: string }> }) {
  const s = await requirePageSession();
  const { scope, status } = await searchParams;
  const mine = scope === "mine";
  const st = PROJECT_STATUSES.includes(status as (typeof PROJECT_STATUSES)[number]) ? status : undefined;
  const projects = await listProjects(s, { mine, status: st });
  const base = mine ? "/projects?scope=mine" : "/projects";
  const href = (k: string) => (k ? `${base}${mine ? "&" : "?"}status=${k}` : base);

  return (
    <section>
      <PageHeader title={mine ? "My Content" : "Team Library"} subtitle={mine ? "Projects you own." : `Everything in ${s.workspace.name} that you're allowed to see.`}
        actions={s.permissions.has("project.create") && <Link className="btn primary" href="/create"><Plus size={16} aria-hidden /> New project</Link>} />
      <nav aria-label="Filter by status" className="row">
        {FILTERS.map(([k, l]) => <Link key={l} className="chip" aria-current={(st ?? "") === k ? "page" : undefined} href={href(k)}>{l}</Link>)}
      </nav>
      <div className="card">
        {projects.length ? (
          <div className="tablewrap">
            <table>
              <caption className="sr">{projects.length} projects</caption>
              <thead><tr><th scope="col">Title</th><th scope="col">Status</th><th scope="col">Function</th><th scope="col">Classification</th><th scope="col">Languages</th><th scope="col">Freshness</th><th scope="col">Updated</th></tr></thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className="clickable">
                    <td>
                      <Link href={`/projects/${p.id}`} className="row" style={{ flexWrap: "nowrap" }}>
                        <Thumb hue={p.hue} width={52} />
                        <span><span className="t" style={{ display: "block" }}>{p.title}</span><span className="meta">{p.owner.displayName} · v{p.currentVersion}</span></span>
                      </Link>
                    </td>
                    <td><StatusPill status={p.status} /></td>
                    <td>{p.businessFunction}</td>
                    <td><ClassificationTag value={p.classification} /></td>
                    <td className="num">{1 + csv(p.targetLanguages).length}</td>
                    <td><FreshnessPill status={freshnessOf(p.nextReviewAt, p.status)} /></td>
                    <td className="meta">{relativeTime(p.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={Folder} title={st ? "No projects match this filter" : mine ? "You haven't created anything yet" : "This workspace has no content yet"}
            action={st ? <Link className="btn sm" href={base}>Show all projects</Link> : s.permissions.has("project.create") ? <Link className="btn sm primary" href="/create">Create your first project</Link> : undefined}>
            {st ? "Try another status." : "Record a process or upload a video, document or presentation. AI drafts a video, a guide and an article for you to review."}
          </EmptyState>
        )}
      </div>
    </section>
  );
}

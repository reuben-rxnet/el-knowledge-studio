import Link from "next/link";
import type { Metadata } from "next";
import { Send } from "lucide-react";
import { requirePageSession } from "@/lib/auth/session";
import { db } from "@/lib/database/client";
import { destinationLabel, DESTINATIONS, languageLabel } from "@/lib/domain/constants";
import { relativeTime } from "@/lib/utilities/format";
import { MockLabel } from "@/components/common/badges";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Thumb } from "@/components/common/thumb";

export const metadata: Metadata = { title: "Publishing" };

export default async function PublishingCenter() {
  const s = await requirePageSession();
  const [ready, recent] = await Promise.all([
    db.project.findMany({ where: { workspaceId: s.workspace.id, status: "approved", deletedAt: null } }),
    db.publishingJob.findMany({ where: { project: { workspaceId: s.workspace.id } }, include: { project: { select: { title: true } } }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  return (
    <section>
      <PageHeader title="Publishing" subtitle="Release approved versions to enterprise destinations. Publishing is never automatic." actions={<MockLabel>All connectors are mocks in this environment</MockLabel>} />
      <div className="grid g4">
        {DESTINATIONS.map((d) => <div key={d.key} className="card kpi"><span className="card-h" style={{ fontSize: 14 }}>{d.label}</span><span className="meta">{d.target}</span><MockLabel>Mock connector</MockLabel></div>)}
        <div className="card kpi"><span className="card-h" style={{ fontSize: 14 }}>Controlled public portal</span><span className="meta">External audiences</span><span className="pill s-neutral">Disabled by policy</span></div>
      </div>
      <div className="card">
        <div className="pad"><h2 className="card-h">Ready to publish</h2></div>
        {ready.length ? <ul className="list">{ready.map((p) => (
          <li key={p.id} className="clickable"><Thumb hue={p.hue} /><Link href={`/projects/${p.id}/publishing`} style={{ flex: 1 }}><span className="t" style={{ display: "block" }}>{p.title}</span><span className="meta">v{p.approvedVersion} approved</span></Link><span className="btn sm primary" aria-hidden>Publish</span></li>
        ))}</ul> : <EmptyState icon={Send} title="Nothing waiting to publish">Approved content appears here, ready for a publisher to release.</EmptyState>}
      </div>
      <div className="card">
        <div className="pad"><h2 className="card-h">Recent publications</h2></div>
        {recent.length ? (
          <div className="tablewrap"><table>
            <thead><tr><th scope="col">Content</th><th scope="col">Version</th><th scope="col">Destination</th><th scope="col">Language</th><th scope="col">When</th></tr></thead>
            <tbody>{recent.map((j) => <tr key={j.id}><td><Link className="link" href={`/projects/${j.projectId}/publishing`}>{j.project.title}</Link></td><td className="num">v{j.version}</td><td>{destinationLabel(j.destination)} {j.simulated && <MockLabel />}</td><td>{languageLabel(j.language)}</td><td className="meta">{relativeTime(j.createdAt)}</td></tr>)}</tbody>
          </table></div>
        ) : <EmptyState icon={Send} title="No publications yet">Every publication is listed here with its version and destination.</EmptyState>}
      </div>
    </section>
  );
}

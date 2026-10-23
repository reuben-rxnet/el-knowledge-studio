import Link from "next/link";
import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { requirePageSession } from "@/lib/auth/session";
import { db } from "@/lib/database/client";
import { relativeTime } from "@/lib/utilities/format";
import { TonePill } from "@/components/common/badges";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";

export const metadata: Metadata = { title: "Audit history" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const s = await requirePageSession();
  if (!s.permissions.has("audit.view")) {
    return <section><div className="card"><EmptyState icon={Lock} title="You don't have access to the audit history" action={<Link className="btn" href="/">Back to Home</Link>}>It needs the audit.view permission (Auditor, Workspace administrator or Enterprise administrator). In the demo, switch persona to an administrator.</EmptyState></div></section>;
  }
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const take = 50;
  const [events, total] = await Promise.all([
    db.auditEvent.findMany({ where: { workspaceId: s.workspace.id }, orderBy: { occurredAt: "desc" }, skip: (page - 1) * take, take }),
    db.auditEvent.count({ where: { workspaceId: s.workspace.id } }),
  ]);
  return (
    <section>
      <PageHeader title="Audit history" subtitle={`Immutable, append-only record for ${s.workspace.name}. Audit messages never contain content text, prompts or personal data.`} />
      <div className="card">
        <div className="tablewrap">
          <table>
            <caption className="sr">Audit events, newest first</caption>
            <thead><tr><th scope="col">Time</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Resource</th><th scope="col">Version</th><th scope="col">Outcome</th><th scope="col">Correlation ID</th><th scope="col">Justification</th></tr></thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="meta" title={e.occurredAt.toISOString()}>{relativeTime(e.occurredAt)}</td>
                  <td>{e.actorName}</td>
                  <td><code>{e.action}</code></td>
                  <td>{e.resourceType === "project" ? <Link className="link" href={`/projects/${e.resourceId}/activity`}>{e.resourceLabel}</Link> : e.resourceLabel}</td>
                  <td className="num">{e.resourceVersion ? `v${e.resourceVersion}` : "—"}</td>
                  <td><TonePill tone={e.outcome === "success" ? "ok" : "err"}>{e.outcome === "success" ? "Success" : e.outcome === "denied" ? "Denied" : "Failure"}</TonePill></td>
                  <td className="meta num">{e.correlationId.slice(0, 8)}</td>
                  <td className="meta">{e.justification ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <nav className="row between" aria-label="Pagination">
        <span className="meta">{total} events · page {page} of {Math.max(1, Math.ceil(total / take))}</span>
        <div className="row">
          {page > 1 && <Link className="btn sm" href={`/audit?page=${page - 1}`}>Newer</Link>}
          {page * take < total && <Link className="btn sm" href={`/audit?page=${page + 1}`}>Older</Link>}
        </div>
      </nav>
    </section>
  );
}

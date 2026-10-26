import { Send } from "lucide-react";
import { requirePageSession } from "@/lib/auth/session";
import { db } from "@/lib/database/client";
import { CLASSIFICATION_POLICY, csv, destinationLabel, DESTINATIONS, languageLabel, type Classification } from "@/lib/domain/constants";
import { relativeTime } from "@/lib/utilities/format";
import { getProjectOr404 } from "@/server/queries";
import { MockLabel } from "@/components/common/badges";
import { EmptyState } from "@/components/common/empty-state";
import { PublishForm } from "@/components/governance/publish-form";
import { services } from "@/lib/services/registry";
import { parseChapters } from "@/lib/studio/render-meta";

export default async function PublishingTab({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePageSession();
  const { id } = await params;
  const p = await getProjectOr404(s, id);
  const [jobs, translations] = await Promise.all([
    db.publishingJob.findMany({ where: { projectId: p.id }, orderBy: { createdAt: "desc" } }),
    db.translationProject.findMany({ where: { projectId: p.id, status: "approved" } }),
  ]);
  const approval = p.approvedVersion ? await db.projectVersion.findUnique({ where: { projectId_number: { projectId: p.id, number: p.approvedVersion } }, select: { officialRenderId: true } }) : null;
  const render = approval?.officialRenderId ? await db.renderJob.findFirst({ where: { id: approval.officialRenderId, projectId: p.id, status: "succeeded" } }) : null;
  const video = render ? { title: `${p.title} · v${render.version} · ${render.language.toUpperCase()}${render.aiVoice ? " · AI voice" : ""}`, engine: render.engine === "studio" ? "Studio" : "Video tab", durationSec: render.durationSec ?? 0, chapters: parseChapters(render.chapters).length } : null;
  const policy = CLASSIFICATION_POLICY[p.classification as Classification];
  const canPublish = s.permissions.has("publish.execute");
  const live = services.liveConnectors();

  return (
    <div className="split">
      {!p.approvedVersion ? (
        <div className="card"><EmptyState icon={Send} title="Not approved yet">Only an approved version can be published. Submit this project for review, and publish once the approver signs off.</EmptyState></div>
      ) : !canPublish ? (
        <div className="card"><EmptyState icon={Send} title="Your role can't publish">Version {p.approvedVersion} is approved. A publisher in {s.workspace.name} releases it to SharePoint, Teams and other destinations.</EmptyState></div>
      ) : (
        <PublishForm projectId={p.id} version={p.approvedVersion} audience={p.audience} video={video} defaults={csv(p.destinations)}
          destinations={DESTINATIONS.map((d) => ({ key: d.key, label: d.label, target: d.target, allowed: policy?.destinations.includes(d.key) ?? false, live: live.includes(d.key) }))}
          languages={[{ code: p.primaryLanguage, label: languageLabel(p.primaryLanguage) }, ...translations.map((t) => ({ code: t.language, label: languageLabel(t.language) }))]} />
      )}
      <div className="card">
        <div className="pad"><h2 className="card-h">Publishing history</h2></div>
        {jobs.length ? (
          <ul className="list">{jobs.map((j) => (
            <li key={j.id}><div style={{ flex: 1 }}><div className="t">{destinationLabel(j.destination)}</div><div className="meta">v{j.version} · {languageLabel(j.language)} · {j.target}{j.renderId ? " · with video" : ""} · {relativeTime(j.createdAt)}</div></div>{j.simulated && <MockLabel />}</li>
          ))}</ul>
        ) : <EmptyState icon={Send} title="Not published yet">Publications to SharePoint, Teams, Stream and other destinations appear here.</EmptyState>}
      </div>
    </div>
  );
}

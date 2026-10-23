import { Sparkles } from "lucide-react";
import { requirePageSession } from "@/lib/auth/session";
import { db } from "@/lib/database/client";
import { services } from "@/lib/services/registry";
import { getProjectOr404 } from "@/server/queries";
import { EmptyState } from "@/components/common/empty-state";
import { ProcessingJourney } from "@/components/content/processing-journey";

export default async function ProcessingPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePageSession();
  const { id } = await params;
  const p = await getProjectOr404(s, id);
  const job = await db.processingJob.findFirst({ where: { projectId: p.id }, orderBy: { createdAt: "desc" } });
  if (!job) return <div className="card"><EmptyState icon={Sparkles} title="No processing history">This project was created without an AI generation job.</EmptyState></div>;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <p className="page-sub" style={{ margin: 0 }}>You can leave this page. You&apos;ll get a notification when the draft is ready.</p>
      <ProcessingJourney key={job.id} projectId={p.id} jobId={job.id} canEdit={s.permissions.has("project.edit")} aiLabel={services.describe().label} />
    </div>
  );
}

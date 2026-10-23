import { requirePageSession } from "@/lib/auth/session";
import { db } from "@/lib/database/client";
import { getProjectOr404 } from "@/server/queries";
import { GuideEditor } from "@/components/editor/guide-editor";
import { isMediaSource } from "@/lib/domain/constants";

export default async function GuidePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ step?: string }> }) {
  const s = await requirePageSession();
  const { id } = await params;
  const { step } = await searchParams;
  const p = await getProjectOr404(s, id);
  const [steps, scenes, flags, source] = await Promise.all([
    db.guideStep.findMany({ where: { projectId: p.id }, orderBy: { order: "asc" } }),
    db.scene.findMany({ where: { projectId: p.id }, orderBy: { order: "asc" }, select: { id: true, startSec: true, endSec: true, redaction: true } }),
    db.reviewFlag.findMany({ where: { projectId: p.id, status: "open" }, select: { stepId: true, kind: true, note: true } }),
    db.sourceAsset.findFirst({ where: { projectId: p.id, storedBytes: true }, orderBy: { createdAt: "desc" }, select: { kind: true } }),
  ]);
  const sceneOf = (sec: number) => scenes.find((sc) => sec >= sc.startSec && sec < sc.endSec);
  return (
    <GuideEditor media={isMediaSource(p.sourceKind)} hasRecording={isMediaSource(p.sourceKind) && !!source && isMediaSource(source.kind)} projectId={p.id} title={p.title} version={p.currentVersion} system={p.sourceSystem} initialStepId={step}
      canEdit={s.permissions.has("guide.edit") && !["processing", "sme-review", "approval-pending", "compliance-review"].includes(p.status)}
      steps={steps.map((st) => ({
        id: st.id, order: st.order, chapter: st.chapter, title: st.title, instruction: st.instruction, expectedResult: st.expectedResult, warning: st.warning, tip: st.tip,
        altText: st.altText, sourceSec: st.sourceSec, sourceRef: st.sourceRef, shotVersion: st.screenshotKey ? st.screenshotKey.slice(-12) : null, redact: !!sceneOf(st.sourceSec)?.redaction, flags: flags.filter((f) => f.stepId === st.id).map((f) => ({ kind: f.kind, note: f.note })), origin: st.origin, markerX: st.markerX, markerY: st.markerY,
        sceneId: sceneOf(st.sourceSec)?.id ?? null,
      }))} />
  );
}

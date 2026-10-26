import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { db } from "@/lib/database/client";
import { getProjectOr404 } from "@/server/queries";
import { loadEdl, studioEnabled, studioSource } from "@/server/studio";
import { StudioEditor } from "@/components/studio/studio-editor";

const LOCKED = ["processing", "sme-review", "approval-pending", "compliance-review"];

/** Studio (beta): the timeline editor. Separate from the Video tab, which stays as it is. */
export default async function StudioPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePageSession();
  const { id } = await params;
  const p = await getProjectOr404(s, id);
  if (!s.permissions.has("project.edit") || !(await studioEnabled())) notFound();
  const note = (title: string, body: string) => <div className="callout tip" role="status"><b>{title}</b>&nbsp;{body}</div>;
  if (p.status === "processing") return note("Still processing.", "Studio opens once the draft is ready.");
  const source = await studioSource(p.id);
  if (!source) return note("Studio edits recordings and videos.", "This project has no recording or video file. Use the Video tab for document and audio projects.");
  const loaded = await loadEdl(p.id, s.user.id);
  if (!loaded) return note("The recording couldn't be read.", "Its length couldn't be determined. Try uploading it again.");
  const script = await db.scriptSegment.findMany({ where: { projectId: p.id }, orderBy: { order: "asc" }, select: { startSec: true, endSec: true, text: true } });
  return (
    <StudioEditor projectId={p.id} initialEdl={loaded.edl} initialRevision={loaded.revision} mediaUrl={`/api/projects/${p.id}/media`}
      cues={script.map((c) => ({ start: c.startSec, end: c.endSec, text: c.text }))} canEdit={!LOCKED.includes(p.status)} />
  );
}

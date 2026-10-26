import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePageSession } from "@/lib/auth/session";
import { db } from "@/lib/database/client";
import { languageLabel } from "@/lib/domain/constants";
import { getProjectOr404 } from "@/server/queries";
import { getBrandTemplate, musicLibrary } from "@/server/settings";
import { expireStaleStudioJobs, latestClassicRender, loadEdl, STUDIO_JOB_KINDS, studioCaptions, studioEnabled, studioSource } from "@/server/studio";
import { StudioEditor } from "@/components/studio/studio-editor";
import { localSpeechEnabled, TTS_LANGUAGES, TTS_VOICES } from "@/lib/services/local/speech";
import type { Word } from "@/lib/studio/edl";

const LOCKED = ["processing", "sme-review", "approval-pending", "compliance-review"];

/** Studio (beta): the timeline editor. Separate from the Video tab, which stays as it is. */
export default async function StudioPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePageSession();
  const { id } = await params;
  const p = await getProjectOr404(s, id);
  if (!s.permissions.has("project.edit") || !(await studioEnabled())) notFound();
  const note = (title: string, body: React.ReactNode) => <div className="callout tip" role="status" data-testid="studio-note"><b>{title}</b>&nbsp;{body}</div>;
  if (p.status === "processing") return note("Still processing.", "Studio opens once the draft is ready.");
  const media = await studioSource(p.id);
  if (!media) return note("Studio needs a video.", <>This project has no screen recording. Render it on the <Link className="link" href={`/projects/${p.id}/video`}>Video tab</Link> first (the audio over the branded background, or the narrated pages), then Studio edits that video.</>);
  const loaded = await loadEdl(p.id, s.user.id);
  if (!loaded) return note("The video couldn't be read.", "Its length couldn't be determined. Try uploading or rendering it again.");
  await expireStaleStudioJobs(p.id);
  const [jobs, captions, scenes, template, music, owner, latest] = await Promise.all([
    Promise.all(STUDIO_JOB_KINDS.map((kind) => db.studioJob.findFirst({ where: { projectId: p.id, kind }, orderBy: { createdAt: "desc" }, select: { kind: true, status: true, detail: true } }))),
    studioCaptions(p, media),
    db.scene.findMany({ where: { projectId: p.id }, orderBy: { order: "asc" }, select: { startSec: true, title: true } }),
    getBrandTemplate(),
    musicLibrary(),
    db.user.findUnique({ where: { id: p.ownerId }, select: { displayName: true } }),
    media.kind === "render" ? latestClassicRender(p.id) : Promise.resolve(null),
  ]);
  let words: Word[] | null = null;
  try { words = media.words ? (JSON.parse(media.words) as Word[]) : null; } catch { words = null; }
  // Scenes are in the recording's time; for a Video tab render they'd need its timing, so they're offered for recordings only.
  const sceneChapters = media.kind === "source" ? scenes.filter((sc, i) => i === 0 || sc.startSec - scenes[i - 1]!.startSec >= 1).map((sc) => ({ srcTime: sc.startSec, title: sc.title })) : [];
  return (
    <StudioEditor projectId={p.id} initialEdl={loaded.edl} initialRevision={loaded.revision} mediaUrl={media.mediaUrl}
      captions={captions} primaryLanguage={p.primaryLanguage} languages={Object.keys(captions).map((code) => ({ code, label: languageLabel(code) }))}
      canEdit={!LOCKED.includes(p.status)} words={words} speechAvailable={localSpeechEnabled()} initialJobs={jobs.filter((j) => j !== null)}
      scenes={sceneChapters} music={music} template={template} voices={TTS_VOICES} ttsLanguages={TTS_LANGUAGES}
      media={{ kind: media.kind, label: media.label, burnedCaptions: media.burnedCaptions, newerRender: latest && latest.id !== media.id ? latest.id : null }}
      project={{ title: p.title, businessFunction: p.businessFunction, processCategory: p.processCategory, version: p.currentVersion, owner: owner?.displayName ?? "" }} />
  );
}

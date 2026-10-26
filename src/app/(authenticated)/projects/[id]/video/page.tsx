import { after } from "next/server";
import { requirePageSession } from "@/lib/auth/session";
import { db } from "@/lib/database/client";
import { isMediaSource, languageLabel } from "@/lib/domain/constants";
import { services } from "@/lib/services/registry";
import { getProjectOr404 } from "@/server/queries";
import { VideoEditor } from "@/components/editor/video-editor";
import { RenderPanel } from "@/components/editor/render-panel";
import { TTS_LANGUAGES, TTS_VOICES } from "@/lib/services/local/speech";
import { pageImageSupport, pagesForScenes } from "@/lib/services/local/slides";
import { ensurePageImages, pageKeysOf } from "@/server/jobs/page-images";

export default async function VideoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ scene?: string }> }) {
  const s = await requirePageSession();
  const { id } = await params;
  const { scene } = await searchParams;
  const p = await getProjectOr404(s, id);
  const [scenes, script, source, translated, steps] = await Promise.all([
    db.scene.findMany({ where: { projectId: p.id }, orderBy: { order: "asc" } }),
    db.scriptSegment.findMany({ where: { projectId: p.id }, orderBy: { order: "asc" } }),
    db.sourceAsset.findFirst({ where: { projectId: p.id, storedBytes: true }, orderBy: { createdAt: "desc" } }),
    db.translationSegment.findMany({ where: { projectId: p.id, sourceType: "script" } }),
    db.guideStep.findMany({ where: { projectId: p.id }, orderBy: { order: "asc" }, select: { sourceRef: true } }),
  ]);
  const media = isMediaSource(p.sourceKind);
  const hasRecording = media && !!source && isMediaSource(source.kind);
  // Primary language + every language with translated script text, for captions and narration preview.
  const byLang = new Map<string, Record<string, string>>();
  for (const t of translated) byLang.set(t.language, { ...(byLang.get(t.language) ?? {}), [t.sourceId]: t.text });
  // Documents and presentations show their real pages: each chapter shows the page its step cites.
  const pageKeys = !hasRecording && source ? pageKeysOf(source.pageImages) : [];
  const support = !hasRecording && source ? pageImageSupport(source.fileName) : null;
  const makingPages = !!source && !!support?.ok && source.pageImages === null;
  if (makingPages) after(() => ensurePageImages(source.id).then(() => undefined, () => undefined));
  const scenePages = pagesForScenes(scenes.length, steps.map((x) => x.sourceRef), pageKeys.length).map((i) => (i === null ? null : `/api/projects/${p.id}/pages/${i + 1}`));
  const languages = [{ code: p.primaryLanguage, label: languageLabel(p.primaryLanguage), texts: {} }, ...[...byLang].map(([code, texts]) => ({ code, label: languageLabel(code), texts }))];

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {!media && <div className="callout tip"><b>Created from a document, so there is no recording.</b>&nbsp;{pageKeys.length ? `Each chapter shows its ${source?.kind === "presentation" ? "slide" : "page"} from ${source?.fileName}.` : ""} Press Play to hear the script read aloud, or render a narrated video below. The timeline shows the order of chapters, not real timings.</div>}
      {makingPages && <div className="callout tip" role="status"><b>Making {source?.kind === "presentation" ? "slide" : "page"} images from {source?.fileName}.</b>&nbsp;Reload this page in a minute to see them in the preview and the rendered video.</div>}
      {support && !support.ok && source?.kind === "presentation" && <div className="callout warn"><b>The slides can&apos;t be shown yet.</b>&nbsp;{support.reason} Until then the video uses text slides.</div>}
      {media && !hasRecording && <div className="callout tip"><b>This demo project has no recording file.</b>&nbsp;Projects you record or upload play their real video here. You can still preview the narration.</div>}
      {script.length > 0 && <div className="row" style={{ gap: 8 }}><span className="meta">Caption files (WebVTT, for Stream or Teams):</span>{languages.map((l) => <a key={l.code} className="chip" href={`/api/projects/${p.id}/captions?lang=${l.code}&download=1`}>{l.label} .vtt</a>)}</div>}
      {script.length > 0 && <RenderPanel projectId={p.id} hasRecording={hasRecording} languages={languages.map(({ code, label }) => ({ code, label }))} voices={TTS_VOICES.map((v) => ({ id: v.id, label: v.label }))} voiceLanguages={TTS_LANGUAGES}
        canRender={s.permissions.has("project.edit") && p.status !== "processing"} />}
      <VideoEditor scenePages={scenePages} projectId={p.id} version={p.currentVersion} duration={p.durationSec} initialSceneId={scene} aiLabel={services.describe().label} hasRecording={hasRecording} languages={languages}
        canEdit={s.permissions.has("project.edit") && !["processing", "sme-review", "approval-pending", "compliance-review"].includes(p.status)}
        scenes={scenes.map(({ id, title, startSec, endSec, focusZoom, redaction }) => ({ id, title, startSec, endSec, focusZoom, redaction }))}
        script={script.map(({ id, startSec, endSec, originalText, text, origin, locked, flagged }) => ({ id, startSec, endSec, originalText, text, origin, locked, flagged }))} />
    </div>
  );
}

import Link from "next/link";
import { ArrowRight, FileText, Globe2, Network, Video } from "lucide-react";
import { requirePageSession } from "@/lib/auth/session";
import { db } from "@/lib/database/client";
import { csv, languageLabel } from "@/lib/domain/constants";
import { formatDate, mmss, relativeTime } from "@/lib/utilities/format";
import { getProjectOr404 } from "@/server/queries";
import { AiLabel, TonePill } from "@/components/common/badges";
import { PlayerScreen } from "@/components/editor/player-screen";
import { SuggestionsCard } from "@/components/governance/suggestions-card";
import { isMediaSource } from "@/lib/domain/constants";

export default async function ProjectOverview({ params }: { params: Promise<{ id: string }> }) {
  const s = await requirePageSession();
  const { id } = await params;
  const p = await getProjectOr404(s, id);
  const [versions, scenes, steps, faqs, job, flagged, redactions] = await Promise.all([
    db.projectVersion.findMany({ where: { projectId: p.id }, orderBy: { number: "desc" } }),
    db.scene.findMany({ where: { projectId: p.id }, orderBy: { order: "asc" } }),
    db.guideStep.count({ where: { projectId: p.id } }),
    db.faqItem.count({ where: { projectId: p.id } }),
    db.processingJob.findFirst({ where: { projectId: p.id }, orderBy: { createdAt: "desc" } }),
    db.scriptSegment.count({ where: { projectId: p.id, flagged: { not: null } } }),
    db.scene.count({ where: { projectId: p.id, redaction: true } }),
  ]);
  const sug = (() => { try { return p.aiSuggestions ? (JSON.parse(p.aiSuggestions) as { title: string; businessFunction: string; audience: string; classification: string; classificationReason: string }) : null; } catch { return null; } })();
  const openFlags = await db.reviewFlag.count({ where: { projectId: p.id, status: "open" } });
  const assets = [
    { label: isMediaSource(p.sourceKind) ? "Polished video" : "Video script and captions", meta: isMediaSource(p.sourceKind) ? `${scenes.length} chapters · ${mmss(p.durationSec)}` : `${scenes.length} chapters · from a document, no recording`, href: "video", icon: Video },
    { label: "Step-by-step guide", meta: `${steps} steps`, href: "guide", icon: FileText },
    { label: "Knowledge article", meta: `Summary, procedure, ${faqs} FAQs`, href: "knowledge", icon: Network },
    { label: "Subtitles and translations", meta: `${1 + csv(p.targetLanguages).length} languages`, href: "translations", icon: Globe2 },
  ];

  return (
    <div className="split">
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="card pad">
          {scenes[0] ? <div className="player" role="img" aria-label={`Preview: ${scenes[0].title}`}><PlayerScreen scene={scenes[0]} index={0} caption={null} /></div>
            : <div className="callout tip"><b>No preview yet.</b>&nbsp;{p.status === "processing" ? <>Processing is still running. <Link className="link" href={`/projects/${p.id}/processing`}>Follow progress</Link>.</> : "Generate a draft from the source to see a preview."}</div>}
          <p style={{ margin: "14px 0 0" }}>{p.description}</p>
        </div>
        <div className="card">
          <div className="pad row between"><h2 className="card-h">Generated assets</h2><AiLabel /></div>
          <ul className="list">{assets.map((a) => (
            <li key={a.label} className="clickable"><a.icon size={18} aria-hidden /><Link href={`/projects/${p.id}/${a.href}`} style={{ flex: 1 }}><span className="t" style={{ display: "block" }}>{a.label}</span><span className="meta">{a.meta}</span></Link><ArrowRight size={16} aria-hidden /></li>
          ))}</ul>
        </div>
        <div className="card pad">
          <h2 className="card-h">AI generation summary</h2>
          <div className="meta" style={{ fontSize: 13, marginTop: 6, display: "grid", gap: 4 }}>
            <span>Last job: {job ? `${job.kind} · ${job.status} · attempt ${job.attempt} · ${relativeTime(job.createdAt)}` : "none"}</span>
            <span>Source grounding: every step is linked to a source timestamp</span>
            <span>Protected terms: {p.sourceSystem || "none set"}</span>
            <span>Uncertain terms flagged: {flagged} · Sensitive regions blurred: {redactions} (confirm in the video editor)</span>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {sug && <SuggestionsCard projectId={p.id} canEdit={s.permissions.has("project.edit")} rows={[
          { field: "title", label: "Title", current: p.title, suggested: sug.title },
          { field: "businessFunction", label: "Business function", current: p.businessFunction, suggested: sug.businessFunction },
          { field: "audience", label: "Audience", current: p.audience, suggested: sug.audience },
          { field: "classification", label: "Classification", current: p.classification, suggested: sug.classification, reason: sug.classificationReason },
        ]} />}
        {openFlags > 0 && <Link href={`/projects/${p.id}/review`} className="callout warn"><b>{openFlags} AI review flag{openFlags === 1 ? "" : "s"} open.</b>&nbsp;Statements in the source an SME should check. Open the Review tab.</Link>}
        <div className="card pad">
          <h2 className="card-h">Metadata</h2>
          <dl className="dl">
            {([
              ["Business function", p.businessFunction], ["Process category", p.processCategory], ["Region", `${p.region} · ${p.country}`], ["Source system", p.sourceSystem || "—"],
              ["Audience", p.audience], ["Primary language", languageLabel(p.primaryLanguage)], ["Owner", p.owner.displayName], ["Backup owner", p.backupOwnerName ?? "—"],
              ["Subject-matter expert", p.smeName ?? "Auto-assigned"], ["Approver", p.approverName ?? "Auto-assigned"], ["Review frequency", `Every ${Math.round(p.reviewFrequencyDays / 30)} months`],
              ["Last reviewed", p.lastReviewedAt ? formatDate(p.lastReviewedAt) : "—"], ["Effective date", p.effectiveAt ? formatDate(p.effectiveAt) : "—"],
            ] as [string, string][]).map(([k, v]) => <div key={k} style={{ display: "contents" }}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
        </div>
        <div className="card pad">
          <h2 className="card-h">Version history</h2>
          <ul className="list" style={{ marginTop: 6 }}>
            {versions.map((v) => (
              <li key={v.id} style={{ padding: "8px 0" }}>
                <b>v{v.number}</b>
                <span className="meta" style={{ flex: 1 }}>{v.note} · {relativeTime(v.createdAt)}</span>
                {v.number === p.publishedVersion ? <TonePill tone="ok">Live</TonePill> : v.number === p.approvedVersion ? <TonePill tone="ok">Approved</TonePill> : v.number === p.currentVersion ? <TonePill tone="info">Current</TonePill> : null}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

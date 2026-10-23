import Link from "next/link";
import { Globe2 } from "lucide-react";
import { requirePageSession } from "@/lib/auth/session";
import { db } from "@/lib/database/client";
import { csv, LANGUAGES, languageLabel } from "@/lib/domain/constants";
import { relativeTime } from "@/lib/utilities/format";
import { getProjectOr404 } from "@/server/queries";
import { TonePill } from "@/components/common/badges";
import { TranslationReview } from "@/components/governance/translation-review";
import { EmptyState } from "@/components/common/empty-state";

const STATUS_LABEL: Record<string, string> = { machine: "Machine translated", terminology: "Terminology check", "regional-review": "Regional review", approved: "Approved", published: "Published" };
const TYPE_LABEL: Record<string, string> = { "step-title": "Step title", "step-instruction": "Step instruction", script: "Script" };
const TYPE_ORDER = ["step-title", "step-instruction", "script"];

export default async function TranslationsTab({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ lang?: string }> }) {
  const s = await requirePageSession();
  const { id } = await params;
  const { lang } = await searchParams;
  const p = await getProjectOr404(s, id);
  const rows = await db.translationProject.findMany({ where: { projectId: p.id }, orderBy: { language: "asc" } });
  if (!rows.length) {
    return <div className="card"><EmptyState icon={Globe2} title="No translations yet">Translations are drafted during processing. Target languages: {csv(p.targetLanguages).map(languageLabel).join(", ") || "none selected"}.</EmptyState></div>;
  }
  const selected = rows.find((r) => r.language === lang)?.language ?? rows[0]!.language;
  const segments = await db.translationSegment.findMany({ where: { projectId: p.id, language: selected } });
  segments.sort((a, b) => TYPE_ORDER.indexOf(a.sourceType) - TYPE_ORDER.indexOf(b.sourceType));
  const rtl = LANGUAGES.find((l) => l.code === selected)?.rtl;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="grid g3">
        {rows.map((t) => (
          <Link key={t.id} href={`/projects/${p.id}/translations?lang=${t.language}`} className="card pad" aria-current={t.language === selected ? "page" : undefined} style={t.language === selected ? { borderColor: "var(--action)" } : undefined}>
            <div className="row between">
              <h2 className="card-h">{languageLabel(t.language)} <span lang={t.language} dir={LANGUAGES.find((l) => l.code === t.language)?.rtl ? "rtl" : undefined} className="meta">{LANGUAGES.find((l) => l.code === t.language)?.native}</span></h2>
              <TonePill tone={t.status === "approved" ? "ok" : "warn"}>{STATUS_LABEL[t.status] ?? t.status}</TonePill>
            </div>
            <div className="bar" style={{ margin: "10px 0" }} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={t.completion} aria-label={`${languageLabel(t.language)} completion`}><i style={{ width: `${t.completion}%` }} /></div>
            <span className="meta">Guide: {t.guideStatus} · Captions: {t.captionStatus} · Voice: {t.voiceStatus} · Reviewer: {t.reviewerName} · {relativeTime(t.updatedAt)}</span>
          </Link>
        ))}
      </div>

      {segments.length ? (
        <TranslationReview projectId={p.id} language={selected} languageName={languageLabel(selected)} sourceName={languageLabel(p.primaryLanguage)} rtl={!!rtl}
          approved={rows.find((r) => r.language === selected)?.status === "approved"} canEdit={s.permissions.has("translation.edit")}
          segments={segments.map((seg) => ({ id: seg.id, part: TYPE_LABEL[seg.sourceType] ?? seg.sourceType, sourceText: seg.sourceText, text: seg.text, status: seg.status }))} />
      ) : <div className="card"><p className="meta pad" style={{ margin: 0 }}>No translated text stored for this language. Seeded demo projects only have status rows. New projects get full machine translations.</p></div>}
      <p className="meta">Protected terms such as {p.sourceSystem || "system names"} are never translated. Machine translations always go to a regional reviewer before approval.{s.permissions.has("translation.edit") ? "" : " Your role can view translations but not edit them."}</p>
    </div>
  );
}

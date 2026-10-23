import Link from "next/link";
import type { Metadata } from "next";
import { Globe2, Lock } from "lucide-react";
import { requirePageSession } from "@/lib/auth/session";
import { db } from "@/lib/database/client";
import { languageLabel, LANGUAGES } from "@/lib/domain/constants";
import { relativeTime } from "@/lib/utilities/format";
import { TonePill } from "@/components/common/badges";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";

export const metadata: Metadata = { title: "Translations" };
const WORKFLOW = ["Machine translation", "Terminology validation", "Regional review", "Corrections", "Approval", "Localized rendering", "Publication"];

export default async function TranslationsPage() {
  const s = await requirePageSession();
  const [rows, projects] = await Promise.all([
    db.translationProject.findMany({ where: { project: { workspaceId: s.workspace.id } }, include: { project: { select: { title: true, sourceSystem: true } } }, orderBy: { updatedAt: "desc" } }),
    db.project.findMany({ where: { workspaceId: s.workspace.id }, select: { sourceSystem: true } }),
  ]);
  const protectedTerms = [...new Set(["EssilorLuxottica", ...projects.map((p) => p.sourceSystem).filter(Boolean)])];
  return (
    <section>
      <PageHeader title="Translations" subtitle="Machine drafts are never published without a regional reviewer. Layouts support right-to-left languages and longer text." />
      <ol className="stepper" aria-label="Localization workflow">{WORKFLOW.map((w, i) => <li key={w}><span className="n">{i + 1}</span>{w}</li>)}</ol>
      <div className="card pad"><h2 className="card-h">Protected terms</h2><p className="meta">These are never translated or rewritten by AI.</p><div className="row">{protectedTerms.map((t) => <span key={t} className="chip"><Lock size={12} aria-hidden /> {t}</span>)}</div></div>
      <div className="card">
        {rows.length ? (
          <div className="tablewrap"><table>
            <thead><tr><th scope="col">Content</th><th scope="col">Language</th><th scope="col">Status</th><th scope="col">Completion</th><th scope="col">Reviewer</th><th scope="col">Updated</th></tr></thead>
            <tbody>{rows.map((t) => (
              <tr key={t.id}>
                <td><Link className="link" href={`/projects/${t.projectId}/translations`}>{t.project.title}</Link></td>
                <td lang={t.language} dir={LANGUAGES.find((l) => l.code === t.language)?.rtl ? "rtl" : undefined}>{languageLabel(t.language)} · {LANGUAGES.find((l) => l.code === t.language)?.native}</td>
                <td><TonePill tone={t.status === "approved" ? "ok" : "warn"}>{t.status.replace("-", " ")}</TonePill></td>
                <td className="num">{t.completion}%</td><td>{t.reviewerName}</td><td className="meta">{relativeTime(t.updatedAt)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <EmptyState icon={Globe2} title="No translations yet">Choose target languages when you create a project. Machine drafts appear here for regional review.</EmptyState>}
      </div>
      <p className="meta">Interface translations other than English need professional language review before production use.</p>
    </section>
  );
}

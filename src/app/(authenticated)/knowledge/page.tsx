import Link from "next/link";
import type { Metadata } from "next";
import { Network, Play, Search, Sparkles } from "lucide-react";
import { requirePageSession } from "@/lib/auth/session";
import { BUSINESS_FUNCTIONS, freshnessOf, FRESHNESS_META, languageLabel } from "@/lib/domain/constants";
import { formatDate, mmss } from "@/lib/utilities/format";
import { services } from "@/lib/services/registry";
import { groundedAnswer, searchKnowledge } from "@/server/search";
import { ClassificationTag, FreshnessPill, StatusPill, TonePill } from "@/components/common/badges";
import { EmptyState } from "@/components/common/empty-state";
import { Thumb } from "@/components/common/thumb";
import { AnswerFeedback } from "@/components/search/answer-feedback";

export const metadata: Metadata = { title: "Knowledge Hub" };

const SUGGESTED = ["How do I open the POS day?", "What if the cash float is wrong?", "How do I request application access?", "Return a prescription lens", "Finish mandatory training"];

function highlight(text: string, terms: string[]) {
  if (!terms.length) return text;
  const re = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "ig");
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}

export default async function KnowledgeHub({ searchParams }: { searchParams: Promise<{ q?: string; fn?: string }> }) {
  const s = await requirePageSession();
  const { q = "", fn } = await searchParams;
  const query = q.trim().slice(0, 300);
  const fnFilter = BUSINESS_FUNCTIONS.includes(fn as (typeof BUSINESS_FUNCTIONS)[number]) ? fn : undefined;
  const { terms, results } = query ? await searchKnowledge(s, query, { fn: fnFilter }) : { terms: [], results: [] };
  const answer = query && results.length ? await groundedAnswer(query, results, s.user.id) : null;
  const cited = answer?.sufficient ? answer.citations.map((c) => results.find((r) => r.stepId === c.stepId)).filter((r): r is NonNullable<typeof r> => !!r) : [];
  const ai = services.describe();

  return (
    <section>
      <div className="hubhead">
        <span className="eyebrow">Knowledge Hub · {s.workspace.name}</span>
        <h1 className="page-title" style={{ fontSize: 34 }}>What do you need to know?</h1>
        <p className="page-sub">Answers come only from approved content you&apos;re allowed to see, with the exact chapter and step.</p>
        <form className="bigsearch" role="search" action="/knowledge">
          <Search size={22} aria-hidden />
          <label htmlFor="hubq" className="sr">Search approved knowledge</label>
          <input type="search" id="hubq" name="q" defaultValue={query} placeholder="Ask a question or search for a process…" autoComplete="off" />
          {fnFilter && <input type="hidden" name="fn" value={fnFilter} />}
          <button className="btn primary" type="submit">Search</button>
        </form>
        <div className="row" style={{ marginTop: 12 }}>
          {SUGGESTED.map((x) => <Link key={x} className="chip" href={`/knowledge?q=${encodeURIComponent(x)}`}>{x}</Link>)}
        </div>
      </div>

      {!query ? (
        <div className="grid g3">
          <div className="card pad"><h2 className="card-h">Browse by function</h2><div className="row" style={{ marginTop: 10 }}>{BUSINESS_FUNCTIONS.slice(0, 8).map((f) => <Link key={f} className="chip" href={`/knowledge?q=${encodeURIComponent(f)}&fn=${encodeURIComponent(f)}`}>{f}</Link>)}</div></div>
          <div className="card pad"><h2 className="card-h">Popular topics</h2><div className="row" style={{ marginTop: 10 }}>{["Store opening", "Access request", "Returns", "Month-end close", "Onboarding"].map((t) => <Link key={t} className="chip" href={`/knowledge?q=${encodeURIComponent(t)}`}>{t}</Link>)}</div></div>
          <div className="card pad"><h2 className="card-h">How answers work</h2><p className="meta" style={{ fontSize: 13 }}>Search covers titles, guide steps, chapters, warnings and FAQs of approved versions. {ai.label} writes answers from those passages only and cites every source.</p></div>
        </div>
      ) : (
        <div className="split">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {answer && (
              <div className="card pad answer" aria-live="polite">
                <div className="row between">
                  <span className="ai-label"><Sparkles size={12} aria-hidden /> AI answer · {ai.label}</span>
                  {answer.sufficient ? <TonePill tone="ok">Grounded in {cited.length} source{cited.length === 1 ? "" : "s"}</TonePill> : <TonePill tone="warn">Not enough evidence</TonePill>}
                </div>
                {answer.sufficient && answer.answer ? (
                  <>
                    <p style={{ fontSize: 15 }}>{answer.answer}</p>
                    <div style={{ display: "grid", gap: 6 }}>
                      {cited.map((r, i) => (
                        <Link key={r.stepId} className="src" href={r.media ? `/projects/${r.projectId}/video${r.sceneId ? `?scene=${r.sceneId}` : ""}` : `/projects/${r.projectId}/guide?step=${r.stepId}`}>
                          <span className="srcn">{i + 1}</span>
                          <span style={{ flex: 1 }}><b>{r.projectTitle}</b> · Step {r.stepOrder + 1}: {r.stepTitle}
                            <span className="meta" style={{ display: "block" }}>v{r.approvedVersion} approved · {r.lastReviewedAt ? `reviewed ${formatDate(r.lastReviewedAt)}` : "not yet reviewed"} · {FRESHNESS_META[freshnessOf(r.nextReviewAt, r.status)].label}</span>
                          </span>
                          {r.media ? <span className="ts"><Play size={11} aria-hidden /> {mmss(r.sourceSec)}</span> : r.sourceRef ? <span className="meta">{r.sourceRef}</span> : null}
                        </Link>
                      ))}
                    </div>
                  </>
                ) : (
                  <p>{answer.error === "RATE_LIMITED" ? "You've asked many questions in a short time, so AI answers are paused for a few minutes. The matching content is listed below." : answer.error ? `The answer service is unavailable right now (${answer.error}). The matching content is listed below.` : <>Approved content doesn&apos;t clearly answer <b>“{query}”</b>. Rather than guess, the closest matches are listed below. Ask the content owner, or report the gap.</>}</p>
                )}
                <p className="meta" style={{ margin: "12px 0 8px" }}>AI-generated answer based on approved enterprise knowledge. Verify critical operational, safety, financial, legal, or compliance decisions with the designated content owner.</p>
                <AnswerFeedback query={query} />
              </div>
            )}
            <div className="card">
              <div className="pad row between"><h2 className="card-h">{results.length} matching result{results.length === 1 ? "" : "s"}</h2><span className="meta">Approved content in {s.workspace.name}</span></div>
              {results.length ? (
                <ul className="list">{results.map((r) => (
                  <li key={r.stepId} className="clickable" style={{ alignItems: "flex-start" }}>
                    <Thumb hue={r.hue} width={72} />
                    <Link href={`/projects/${r.projectId}/guide?step=${r.stepId}`} style={{ flex: 1, minWidth: 0 }}>
                      <span className="row" style={{ gap: 8 }}><span className="t">{r.projectTitle}</span><StatusPill status={r.status} /><ClassificationTag value={r.classification} /></span>
                      <span className="meta" style={{ display: "block" }}>Guide step {r.stepOrder + 1} · {r.chapter}{r.media ? ` · video ${mmss(r.sourceSec)}` : r.sourceRef ? ` · ${r.sourceRef}` : ""}</span>
                      <span style={{ display: "block", margin: "4px 0 0", fontSize: 13.5 }}>{highlight(r.instruction, terms)}</span>
                      <span className="meta" style={{ display: "block" }}>{r.businessFunction} · {languageLabel(r.language)} · Owner {r.owner} · v{r.approvedVersion} approved{r.lastReviewedAt ? ` · reviewed ${formatDate(r.lastReviewedAt)}` : ""}</span>
                    </Link>
                    <span className="meta" title="Relevance">{Math.round(r.score * 100)}%</span>
                  </li>
                ))}</ul>
              ) : <EmptyState icon={Network} title="No approved content matches">Try different words or browse by function. If this process isn&apos;t documented yet, ask a content owner to create it.</EmptyState>}
            </div>
          </div>
          <div className="card pad">
            <h2 className="card-h">Filter by function</h2>
            <div className="row" style={{ marginTop: 10 }}>
              <Link className="chip" aria-current={(!fnFilter) ? "page" : undefined} href={`/knowledge?q=${encodeURIComponent(query)}`}>All</Link>
              {BUSINESS_FUNCTIONS.map((f) => <Link key={f} className="chip" aria-current={(fnFilter === f) ? "page" : undefined} href={`/knowledge?q=${encodeURIComponent(query)}&fn=${encodeURIComponent(f)}`}>{f}</Link>)}
            </div>
            {results[0] && <div style={{ marginTop: 16 }}><h3 className="card-h" style={{ fontSize: 14 }}>Freshness of top result</h3><div style={{ marginTop: 6 }}><FreshnessPill status={freshnessOf(results[0].nextReviewAt, results[0].status)} /></div></div>}
          </div>
        </div>
      )}
    </section>
  );
}

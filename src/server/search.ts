import "server-only";
import { db } from "@/lib/database/client";
import type { Session } from "@/lib/auth/session";
import { tokenize } from "@/lib/services/mock";
import { aiProviderId, services } from "@/lib/services/registry";
import { isMediaSource } from "@/lib/domain/constants";

export interface SearchResult {
  projectId: string; projectTitle: string; stepId: string; stepOrder: number; stepTitle: string; chapter: string; instruction: string; warning: string | null;
  sourceSec: number; sourceRef: string | null; media: boolean; sceneId: string | null; businessFunction: string; language: string; owner: string; status: string; classification: string;
  approvedVersion: number | null; lastReviewedAt: Date | null; nextReviewAt: Date | null; score: number; hue: number; workspaceName: string;
}

/**
 * Search approved knowledge the user may see: only their active workspace, only projects with an
 * approved version, never Restricted content. Inaccessible content is never scored or summarised.
 * Production: Azure AI Search hybrid (BM25 + vector) with security trimming on workspace IDs.
 */
export async function searchKnowledge(session: Session, q: string, filters: { fn?: string } = {}): Promise<{ terms: string[]; results: SearchResult[] }> {
  const terms = tokenize(q);
  if (!terms.length) return { terms, results: [] };
  const projects = await db.project.findMany({
    // Roles are per workspace, so search is trimmed to the active one (switch workspace to search another).
    where: { workspaceId: session.workspace.id, deletedAt: null, approvedVersion: { not: null }, classification: { not: "Restricted" }, ...(filters.fn ? { businessFunction: filters.fn } : {}) },
    include: { steps: { orderBy: { order: "asc" } }, scenes: { orderBy: { order: "asc" } }, owner: { select: { displayName: true } }, workspace: { select: { name: true } } },
  });
  const results: SearchResult[] = [];
  for (const p of projects) {
    for (const st of p.steps) {
      const hay = `${st.title} ${st.instruction} ${st.warning ?? ""} ${st.tip ?? ""} ${st.chapter} ${p.title} ${p.sourceSystem} ${p.description}`.toLowerCase();
      const hits = terms.filter((t) => hay.includes(t)).length;
      if (!hits) continue;
      const titleBoost = terms.filter((t) => st.title.toLowerCase().includes(t)).length * 0.15;
      const scene = p.scenes.find((sc) => st.sourceSec >= sc.startSec && st.sourceSec < sc.endSec) ?? p.scenes[st.order] ?? null;
      results.push({
        projectId: p.id, projectTitle: p.title, stepId: st.id, stepOrder: st.order, stepTitle: st.title, chapter: st.chapter, instruction: st.instruction, warning: st.warning,
        sourceSec: st.sourceSec, sourceRef: st.sourceRef, media: isMediaSource(p.sourceKind), sceneId: scene?.id ?? null, businessFunction: p.businessFunction, language: p.primaryLanguage, owner: p.owner.displayName,
        status: p.status, classification: p.classification, approvedVersion: p.approvedVersion, lastReviewedAt: p.lastReviewedAt, nextReviewAt: p.nextReviewAt,
        score: Math.min(1, hits / terms.length + titleBoost), hue: p.hue, workspaceName: p.workspace.name,
      });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return { terms, results: results.slice(0, 10) };
}

export async function groundedAnswer(question: string, results: SearchResult[]) {
  // With an external provider, only classifications approved for external AI are used as evidence.
  const eligible = aiProviderId() === "openai" ? results.filter((r) => r.classification !== "Highly Confidential") : results;
  const evidence = eligible.slice(0, 5).map((r) => ({ projectId: r.projectId, stepId: r.stepId, text: `${r.projectTitle} · Step ${r.stepOrder + 1}: ${r.stepTitle}\n${r.instruction}${r.warning ? ` Warning: ${r.warning}` : ""}` }));
  try {
    const a = await services.answer().answer(question, evidence);
    return { ...a, error: null as string | null };
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "ANSWER_FAILED";
    return { answer: null, sufficient: false, citations: [], error: code };
  }
}

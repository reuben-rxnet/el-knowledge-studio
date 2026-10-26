import "server-only";
import type { Prisma } from "@prisma/client";
import type { VersionSnapshot } from "@/lib/domain/version-snapshot";

/** Reads the project's content as it is right now, inside the approval transaction so nothing changes in between. */
export async function takeVersionSnapshot(tx: Prisma.TransactionClient, projectId: string, version: number): Promise<VersionSnapshot> {
  const [p, steps, faqs, script, translations, approved] = await Promise.all([
    tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { title: true, description: true, primaryLanguage: true } }),
    tx.guideStep.findMany({ where: { projectId }, orderBy: { order: "asc" } }),
    tx.faqItem.findMany({ where: { projectId } }),
    tx.scriptSegment.findMany({ where: { projectId }, orderBy: { order: "asc" } }),
    tx.translationSegment.findMany({ where: { projectId } }),
    tx.translationProject.findMany({ where: { projectId, status: { in: ["approved", "published"] } }, select: { language: true } }),
  ]);
  return {
    format: 1, version, takenAt: new Date().toISOString(), title: p.title, description: p.description, primaryLanguage: p.primaryLanguage,
    steps: steps.map((s) => ({ id: s.id, order: s.order, chapter: s.chapter, title: s.title, instruction: s.instruction, expectedResult: s.expectedResult, warning: s.warning, tip: s.tip, sourceRef: s.sourceRef })),
    faqs: faqs.map((f) => ({ question: f.question, answer: f.answer })),
    script: script.map((s) => ({ id: s.id, order: s.order, startSec: s.startSec, endSec: s.endSec, text: s.text })),
    translations: translations.map((t) => ({ language: t.language, sourceType: t.sourceType, sourceId: t.sourceId, text: t.text, status: t.status })),
    approvedLanguages: approved.map((t) => t.language),
  };
}

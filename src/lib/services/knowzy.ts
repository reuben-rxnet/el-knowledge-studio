import "server-only";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/database/client";
import { languageLabel } from "@/lib/domain/constants";
import { AppError } from "@/lib/utilities/errors";
import type { PublishingConnector } from "./interfaces";

/**
 * Knowzy connector. Knowzy ingests a synchronized folder (its FILE_REPOSITORY source), so publishing
 * writes the approved guide as Markdown into KNOWZY_EXPORT_DIR, one folder per workspace:
 *   <dir>/<workspace-slug>/<projectId>.<lang>.md          the guide
 *   <dir>/<workspace-slug>/<projectId>.<lang>.md.meta.json  Knowzy's sidecar: version, dates, metadata
 * The file name never changes for a project and language, so republishing updates the same Knowzy document.
 * Access inside Knowzy is decided by Knowzy (the source's corpus boundary); the sidecar declares no access.
 */
export interface KnowzyGuide {
  projectId: string;
  title: string;
  description: string;
  version: number;
  language: string;
  classification: string;
  workspace: { slug: string; name: string };
  businessFunction: string;
  processCategory: string;
  sourceSystem: string;
  audience: string;
  owner: string;
  approvedAt: Date;
  steps: { chapter: string; title: string; instruction: string; expectedResult: string | null; warning: string | null; tip: string | null }[];
  faqs: { question: string; answer: string }[];
}

/** One line of Markdown text: no line breaks, and nothing that turns into a heading or list by accident. */
const inline = (s: string) => s.replace(/\s*\n\s*/g, " ").trim();

export function knowzyMarkdown(g: KnowzyGuide): string {
  const out: string[] = [`# ${inline(g.title)}`, ""];
  if (g.description.trim()) out.push(g.description.trim(), "");
  out.push(
    `- Version: ${g.version} (approved ${g.approvedAt.toISOString().slice(0, 10)})`,
    `- Language: ${languageLabel(g.language)}`,
    `- Classification: ${g.classification}`,
    `- Business function: ${inline(g.businessFunction)} · ${inline(g.processCategory)}`,
    `- System: ${inline(g.sourceSystem)}`,
    `- Owner: ${inline(g.owner)}`,
    "",
  );
  let chapter = "";
  g.steps.forEach((s, i) => {
    if (s.chapter && s.chapter !== chapter) { chapter = s.chapter; out.push(`## ${inline(chapter)}`, ""); }
    out.push(`### Step ${i + 1}. ${inline(s.title)}`, "", s.instruction.trim(), "");
    if (s.expectedResult) out.push(`**Expected result:** ${inline(s.expectedResult)}`, "");
    if (s.warning) out.push(`> **Warning:** ${inline(s.warning)}`, "");
    if (s.tip) out.push(`**Tip:** ${inline(s.tip)}`, "");
  });
  if (g.faqs.length) {
    out.push("## Frequently asked questions", "");
    for (const f of g.faqs) out.push(`**${inline(f.question)}**`, "", f.answer.trim(), "");
  }
  out.push("---", `Published from EL Knowledge Studio (project ${g.projectId}, version ${g.version}).`, "");
  return out.join("\n");
}

export function knowzySidecar(g: KnowzyGuide) {
  return {
    sourceVersion: String(g.version),
    sourceModifiedAt: g.approvedAt.toISOString(),
    mimeType: "text/markdown",
    metadata: {
      source: "EL Knowledge Studio",
      projectId: g.projectId,
      title: g.title,
      language: g.language,
      classification: g.classification,
      workspace: g.workspace.name,
      businessFunction: g.businessFunction,
      processCategory: g.processCategory,
      system: g.sourceSystem,
      audience: g.audience,
      owner: g.owner,
    },
  };
}

/** Loads the approved content. Steps aren't stored per version, so a newer draft blocks the export. */
async function loadGuide(projectId: string, version: number, language: string): Promise<KnowzyGuide> {
  const p = await db.project.findUnique({
    where: { id: projectId },
    include: { workspace: true, owner: true, steps: { orderBy: { order: "asc" } }, faqs: true },
  });
  if (!p || p.approvedVersion !== version) throw new AppError("INVALID_STATE", "Only the approved version can be sent to Knowzy.");
  if (p.currentVersion !== version) throw new AppError("INVALID_STATE", `Version ${p.currentVersion} is being edited, so the approved version ${version} can't be exported to Knowzy. Approve the new version first.`);
  let steps = p.steps.map((s) => ({ id: s.id, chapter: s.chapter, title: s.title, instruction: s.instruction, expectedResult: s.expectedResult, warning: s.warning, tip: s.tip }));
  if (language !== p.primaryLanguage) {
    const tr = await db.translationProject.findUnique({ where: { projectId_language: { projectId, language } } });
    if (!tr || !["approved", "published"].includes(tr.status)) throw new AppError("INVALID_STATE", `The ${languageLabel(language)} translation isn't approved yet.`);
    const segs = await db.translationSegment.findMany({ where: { projectId, language, sourceType: { in: ["step-title", "step-instruction"] } } });
    const t = new Map(segs.map((x) => [`${x.sourceType}:${x.sourceId}`, x.text]));
    // Only the translated fields; untranslated notes would mix languages, so they're left out.
    steps = steps.map((s) => ({ ...s, title: t.get(`step-title:${s.id}`) ?? s.title, instruction: t.get(`step-instruction:${s.id}`) ?? s.instruction, expectedResult: null, warning: null, tip: null }));
  }
  const approval = await db.projectVersion.findUnique({ where: { projectId_number: { projectId, number: version } } });
  return {
    projectId: p.id, title: p.title, description: p.description, version, language, classification: p.classification,
    workspace: { slug: p.workspace.slug, name: p.workspace.name },
    businessFunction: p.businessFunction, processCategory: p.processCategory, sourceSystem: p.sourceSystem, audience: p.audience,
    owner: p.owner.displayName, approvedAt: p.lastReviewedAt ?? approval?.createdAt ?? new Date(),
    steps, faqs: language === p.primaryLanguage ? p.faqs.map((f) => ({ question: f.question, answer: f.answer })) : [],
  };
}

/** Writes via a temporary name Knowzy ignores, then renames, so a sync never reads half a file. */
async function writeAtomic(file: string, content: string) {
  const tmp = `${file}.partial`;
  await writeFile(tmp, content, "utf8");
  await rename(tmp, file);
}

export function knowzyFileConnector(exportDir: string): PublishingConnector {
  const root = path.resolve(exportDir);
  return {
    key: "knowzy",
    simulated: false,
    async publish(input) {
      const g = await loadGuide(input.projectId, input.version, input.language);
      if (!/^[\w-]+$/.test(g.workspace.slug) || !/^[\w-]+$/.test(g.projectId) || !/^[\w-]+$/.test(g.language)) throw new AppError("INVALID_STATE", "This project can't be exported: unexpected identifier.");
      const dir = path.join(root, g.workspace.slug);
      const file = path.join(dir, `${g.projectId}.${g.language}.md`);
      try {
        await mkdir(dir, { recursive: true });
        await writeAtomic(`${file}.meta.json`, JSON.stringify(knowzySidecar(g), null, 2));
        await writeAtomic(file, knowzyMarkdown(g));
      } catch {
        return { status: "failed", simulated: false, externalRef: "", message: "The Knowzy export folder couldn't be written. Ask an administrator to check KNOWZY_EXPORT_DIR." };
      }
      return { status: "succeeded", simulated: false, externalRef: `knowzy-file://${g.workspace.slug}/${path.basename(file)}`, message: `Exported to the Knowzy folder; Knowzy picks it up on its next sync.` };
    },
  };
}

import "server-only";
import { db } from "@/lib/database/client";
import { csv, languageLabel } from "@/lib/domain/constants";
import { generatedContentSchema, type GeneratedContent } from "@/lib/services/interfaces";
import { parseStageState, type StageState, type StageStatus } from "@/lib/services/processing-plan";
import { readStoredFile, withLocalFile } from "@/lib/services/storage";
import { pageImageSupport } from "@/lib/services/local/slides";
import { ensurePageImages } from "./page-images";
import { localSpeechEnabled, localTranscriber } from "@/lib/services/local/speech";
import { extractDocumentText } from "@/lib/services/extract";
import { aiProviderId, services } from "@/lib/services/registry";

const LEASE_MS = 5 * 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const codeOf = (e: unknown) => (e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : e instanceof Error ? e.name : "UNKNOWN");
/** Provider messages are written by us (see OpenAIError), never quoted from the provider. */
const detailOf = (e: unknown) => (e instanceof Error ? e.message.slice(0, 200) : "Unexpected error");

class Cancelled extends Error {}

/**
 * ContentGenerationJob runner. Runs after the creating request responds (next/server `after`),
 * or is resumed by the progress poller when a lease has expired (e.g. after a server restart).
 * A lease (conditional update) guarantees one runner per job. Every AI output is schema-validated
 * before it is stored; optional stages (transcription, translations, quiz) can fail without
 * losing the draft, which ends the job as "partial".
 */
export async function runLiveJob(jobId: string) {
  const now = new Date();
  const claim = await db.processingJob.updateMany({
    where: { id: jobId, status: { in: ["queued", "running"] }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
    data: { status: "running", leaseUntil: new Date(now.getTime() + LEASE_MS) },
  });
  if (!claim.count) return;

  const job = await db.processingJob.findUniqueOrThrow({ where: { id: jobId }, include: { project: { include: { sources: { orderBy: { createdAt: "desc" } } } } } });
  const p = job.project;
  const state: StageState = parseStageState(job.stageState);
  const mock = aiProviderId() === "mock";
  const pace = () => (mock ? sleep(900) : Promise.resolve());
  let partial = false;

  const set = async (keys: string[], status: StageStatus, detail?: string) => {
    for (const k of keys) state[k] = { status, ...(detail ? { detail } : {}) };
    const cur = await db.processingJob.update({ where: { id: job.id }, data: { stageState: JSON.stringify(state), leaseUntil: new Date(Date.now() + LEASE_MS) }, select: { status: true } });
    if (cur.status === "cancelled") throw new Cancelled();
  };
  const done = (k: string) => state[k]?.status === "succeeded" || state[k]?.status === "skipped";

  try {
    const source = p.sources[0];

    // Capture
    if (!done("ingest")) {
      await set(["ingest", "scan"], "running"); await pace();
      await set(["ingest"], "succeeded", source?.storedBytes ? `${source.fileName} stored in the ${p.region} data region` : "Source details recorded (file not stored)");
      await set(["scan"], "succeeded", `Malware scan: ${source?.scanStatus ?? "clean"} (simulated scanner)`);
    }

    // Understanding + transcription: build the source text the model works from
    let sourceText = source?.extractedText ?? "";
    let segments: { startSec: number; endSec: number; text: string }[] = [];
    let durationSec = p.durationSec;
    if (!done("extract")) {
      await set(["extract"], "running"); await pace();
      const isMedia = source && ["recording", "video", "audio", "meeting"].includes(source.kind);
      if (source?.storedBytes && !isMedia) {
        const text = await extractDocumentText(await readStoredFile(source.storageKey), source.fileName).catch(() => null);
        if (text) {
          sourceText = text;
          await db.sourceAsset.update({ where: { id: source.id }, data: { extractedText: text } });
          await set(["extract"], "succeeded", `${text.length.toLocaleString()} characters of text extracted from ${source.fileName}`);
        } else await set(["extract"], "skipped", "No readable text found in the file. The creator's notes are used instead");
      } else await set(["extract"], isMedia ? "succeeded" : "skipped", isMedia ? "Audio track prepared for transcription" : "No file to read. The creator's notes are used");
      if (source?.storedBytes && !isMedia) {
        // Documents and presentations: the real pages become the video's frames.
        const support = pageImageSupport(source.fileName);
        const pages = support.ok ? await ensurePageImages(source.id).catch(() => null) : [];
        if (pages?.length) await set(["detect-scenes"], "succeeded", `${pages.length} ${source.kind === "presentation" ? "slide" : "page"} image${pages.length === 1 ? "" : "s"} made for the video`);
        else await set(["detect-scenes"], "skipped", support.ok ? "The pages couldn't be turned into images. The video uses text slides instead" : `${support.reason} The video uses text slides instead`);
      } else await set(["detect-scenes"], "skipped", "Visual scene detection needs Azure AI Video Indexer. Chapters come from the narration and steps instead");
    }
    if (!done("transcribe")) {
      await set(["transcribe"], "running");
      const transcriber = services.transcriber();
      const media = source && source.storedBytes && ["recording", "video", "audio", "meeting"].includes(source.kind);
      if (!media) await set(["transcribe"], "skipped", "No recording or audio to transcribe");
      else if (!transcriber.available && !localSpeechEnabled()) await set(["transcribe"], "skipped", "Transcription is switched off (SPEECH_PROVIDER=off). The creator's notes are used");
      else {
        // Gateway transcription when configured; otherwise open-source Whisper on this server.
        const local = !transcriber.available;
        try {
          if (local) await set(["transcribe"], "running", "Transcribing with Whisper on this server (the first run downloads the model)");
          const t = local
            ? await withLocalFile(source.storageKey, (file) => localTranscriber.transcribeFile(file, p.primaryLanguage))
            : await transcriber.transcribe({ file: new Blob([new Uint8Array(await readStoredFile(source.storageKey))], { type: source.mimeType }), fileName: source.fileName, language: p.primaryLanguage });
          // Whisper doesn't know company terms: restore protected names to their exact spelling.
          const terms = [p.sourceSystem, "EssilorLuxottica"].filter(Boolean);
          const escape = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const fix = (x: string) => terms.reduce((acc, term) => acc.replace(new RegExp(escape(term), "gi"), term), x);
          sourceText = fix(t.text);
          segments = t.segments.map((sg) => ({ ...sg, text: fix(sg.text) }));
          if (segments.length) durationSec = Math.max(durationSec, segments.at(-1)!.endSec);
          await db.sourceAsset.update({ where: { id: source.id }, data: { extractedText: sourceText } });
          await set(["transcribe"], t.text ? "succeeded" : "skipped", t.text ? `${t.text.split(/\s+/).length.toLocaleString()} words transcribed${local ? " with Whisper on this server" : ""}` : "The recording has no speech");
        } catch (e) {
          partial = true;
          await set(["transcribe"], "failed", `${detailOf(e)} The creator's notes are used instead`);
        }
      }
    } else sourceText = source?.extractedText ?? sourceText;

    // Knowledge extraction + content creation (one structured Codex call)
    const genKeys = ["detect-sensitive", "chapters", "create-script", "create-guide"];
    await set(genKeys, "running");
    const isMediaSource = !!source && ["recording", "video", "audio", "meeting"].includes(source.kind);
    const raw = await services.guide().generate({
      sourceType: isMediaSource ? "recording" : "document",
      title: p.title, description: p.description, businessFunction: p.businessFunction, sourceSystem: p.sourceSystem, audience: p.audience,
      primaryLanguage: p.primaryLanguage, durationSec: durationSec || 240, protectedTerms: [p.sourceSystem, "EssilorLuxottica"].filter(Boolean),
      sourceText: segments.length ? segments.map((s) => `[${s.startSec}s] ${s.text}`).join("\n") : sourceText || undefined,
    });
    await pace();
    const content = generatedContentSchema.parse(raw); // never stored unless valid
    // Documents have no timeline: steps are spaced evenly for the read-aloud preview, never shown as timestamps.
    if (!isMediaSource) content.steps.forEach((st, i) => { st.sourceSec = i * 10; });
    const dur = Math.max(durationSec, (content.steps.at(-1)?.sourceSec ?? 0) + 30);
    await writeGeneratedContent(p.id, content, dur);
    await set(["detect-sensitive"], "succeeded", content.reviewFlags.length ? `${content.reviewFlags.length} statement(s) flagged for SME review${content.sensitiveRegions.length ? `, ${content.sensitiveRegions.length} sensitive item(s) for redaction` : ""}` : content.sensitiveRegions.length ? `${content.sensitiveRegions.length} sensitive item(s) flagged for redaction` : "Nothing sensitive detected in the text");
    await set(["chapters"], "succeeded", `${content.chapters.length} chapters`);
    await set(["create-script"], "succeeded", "Script written from the source; original transcript kept for comparison");
    await set(["create-guide"], "succeeded", `${content.steps.length} steps, ${content.faqs.length} FAQs and a knowledge article`);
    await set(["screenshots"], "skipped", "Screenshot capture needs the video render worker (planned). Placeholders are shown");
    await set(["subtitles"], "succeeded", "Captions timed from the script");
    await set(["voiceover"], "skipped", "Generated on demand: use Render video on the Video tab (open-source Kokoro voice, English)");
    await set(["preview"], "skipped", "Rendered on demand: use Render video on the Video tab");

    // Quiz (optional)
    await set(["quiz"], "running");
    try {
      const steps = await db.guideStep.findMany({ where: { projectId: p.id }, orderBy: { order: "asc" } });
      const flagged = content.reviewFlags.map((r) => r.quote);
      const quiz = await services.quiz().generate({ title: p.title, language: p.primaryLanguage, flagged, steps: steps.map((s) => ({ order: s.order, title: s.title, instruction: s.instruction, warning: s.warning })) });
      // Deterministic guard: never keep a question that tests a statement under SME review.
      const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const safe = quiz.questions.filter((q) => !flagged.some((f) => norm(f).length > 8 && norm(`${q.question} ${q.options.join(" ")} ${q.explanation}`).includes(norm(f))));
      await db.$transaction([
        db.quizQuestion.deleteMany({ where: { projectId: p.id } }),
        ...safe.map((q, i) => db.quizQuestion.create({ data: { projectId: p.id, order: i, kind: q.kind, question: q.question, options: JSON.stringify(q.options), correct: JSON.stringify(q.correct), explanation: q.explanation, difficulty: q.difficulty, objective: q.objective, sourceStepOrder: q.sourceStepOrder } })),
      ]);
      const dropped = quiz.questions.length - safe.length;
      await set(["quiz"], "succeeded", `${safe.length} questions drafted${dropped ? ` (${dropped} removed: they tested a flagged statement)` : ""}. They need review before publishing`);
    } catch (e) {
      partial = true;
      await set(["quiz"], "failed", `Quiz not generated: ${detailOf(e)}`);
    }

    // Localization (optional, per language)
    const targets = csv(p.targetLanguages);
    if (!targets.length) await set(["translations"], "skipped", "No target languages selected");
    else {
      await set(["translations"], "running");
      const [steps, script] = await Promise.all([
        db.guideStep.findMany({ where: { projectId: p.id }, orderBy: { order: "asc" } }),
        db.scriptSegment.findMany({ where: { projectId: p.id }, orderBy: { order: "asc" } }),
      ]);
      const items = [
        ...steps.map((s) => ({ type: "step-title", id: s.id, text: s.title })),
        ...steps.map((s) => ({ type: "step-instruction", id: s.id, text: s.instruction })),
        ...script.map((s) => ({ type: "script", id: s.id, text: s.text })),
      ];
      const okLangs: string[] = [];
      const failed: string[] = [];
      for (const lang of targets) {
        try {
          const out = await services.translator().translate({ texts: items.map((x) => x.text), from: p.primaryLanguage, to: lang, protectedTerms: [p.sourceSystem, "EssilorLuxottica"].filter(Boolean) });
          await db.$transaction([
            ...items.map((x, i) => db.translationSegment.upsert({
              where: { projectId_language_sourceType_sourceId: { projectId: p.id, language: lang, sourceType: x.type, sourceId: x.id } },
              update: { sourceText: x.text, text: out[i]!, status: "machine" },
              create: { projectId: p.id, language: lang, sourceType: x.type, sourceId: x.id, sourceText: x.text, text: out[i]! },
            })),
            db.translationProject.upsert({
              where: { projectId_language: { projectId: p.id, language: lang } },
              update: { status: "regional-review", completion: 80, guideStatus: "Machine translated", captionStatus: "Machine translated" },
              create: { projectId: p.id, language: lang, status: "regional-review", reviewerName: "Unassigned", completion: 80, videoStatus: "Not started", guideStatus: "Machine translated", captionStatus: "Machine translated", voiceStatus: "Not available" },
            }),
          ]);
          okLangs.push(languageLabel(lang));
        } catch {
          failed.push(languageLabel(lang));
        }
        await set(["translations"], "running", `${okLangs.length + failed.length} of ${targets.length} languages`);
      }
      if (failed.length) partial = true;
      await set(["translations"], failed.length === targets.length ? "failed" : "succeeded", `${okLangs.length ? `Machine translated: ${okLangs.join(", ")}` : ""}${failed.length ? `${okLangs.length ? ". " : ""}Failed: ${failed.join(", ")}` : ""}. A regional reviewer must approve each language`);
    }

    // Quality review (deterministic checks)
    await set(["quality-check"], "running"); await pace();
    const [steps, script] = await Promise.all([db.guideStep.findMany({ where: { projectId: p.id } }), db.scriptSegment.count({ where: { projectId: p.id } })]);
    const issues: string[] = [];
    if (!steps.length) issues.push("no steps");
    if (steps.some((s) => s.sourceSec > dur)) issues.push("timestamps beyond the recording");
    if (p.sourceSystem && !steps.some((s) => s.instruction.includes(p.sourceSystem))) issues.push(`“${p.sourceSystem}” not mentioned`);
    await set(["quality-check"], "succeeded", issues.length ? `Check before review: ${issues.join("; ")}` : `${steps.length} steps and ${script} script paragraphs passed structure, timestamp and terminology checks`);

    await db.$transaction([
      db.project.update({ where: { id: p.id }, data: { status: "ai-generated", durationSec: dur } }),
      db.processingJob.update({ where: { id: job.id }, data: { status: partial ? "partial" : "succeeded", completedAt: new Date(), materialized: true, leaseUntil: null } }),
      db.notification.create({ data: { userId: p.ownerId, kind: "processing.completed", title: partial ? "Draft ready (with warnings)" : "Your draft is ready", body: `${p.title}: video, guide and article drafts are ready to review.${partial ? " Some optional steps didn't complete. See the processing page." : ""}`, href: `/projects/${p.id}/video` } }),
      db.auditEvent.create({ data: { actorId: p.ownerId, actorName: "EL Knowledge Studio (system)", action: "ai.generation.completed", resourceType: "project", resourceId: p.id, resourceLabel: `${p.title} (${aiProviderId() === "openai" ? "OpenAI Codex" : "simulated AI"})`, resourceVersion: p.currentVersion, workspaceId: p.workspaceId, outcome: "success", correlationId: job.correlationId } }),
    ]);
  } catch (e) {
    if (e instanceof Cancelled) return;
    const code = codeOf(e).slice(0, 64);
    for (const [k, v] of Object.entries(state)) if (v.status === "running") state[k] = { status: "failed", detail: detailOf(e) };
    await db.$transaction([
      db.processingJob.update({ where: { id: job.id }, data: { status: "failed", errorCode: code, completedAt: new Date(), leaseUntil: null, stageState: JSON.stringify(state) } }),
      db.project.update({ where: { id: p.id }, data: { status: "draft" } }),
      db.auditEvent.create({ data: { actorId: p.ownerId, actorName: "EL Knowledge Studio (system)", action: "ai.generation.completed", resourceType: "project", resourceId: p.id, resourceLabel: p.title, resourceVersion: p.currentVersion, workspaceId: p.workspaceId, outcome: "failure", correlationId: job.correlationId, justification: code } }),
      db.notification.create({ data: { userId: p.ownerId, kind: "processing.failed", title: "Processing failed", body: `${p.title}: the AI draft couldn't be created (${code}). Your source is kept. Retry from the processing page.`, href: `/projects/${p.id}/processing` } }),
    ]);
  }
}

async function writeGeneratedContent(projectId: string, content: GeneratedContent, dur: number) {
  // Keep the model's step indexes (reviewFlags and sensitiveRegions refer to them) while ordering by time.
  const ordered = content.steps.map((s, idx) => ({ s, idx })).sort((a, b) => a.s.sourceSec - b.s.sourceSec);
  // A warning is shown once: identical repeats ("Wait green light." x11) stay on the first step only.
  const normWarn = (w: string) => w.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const seenWarnings = new Set<string>();
  const stepIds = new Map<number, string>();
  await db.$transaction(async (tx) => {
    await tx.scene.deleteMany({ where: { projectId } });
    await tx.scriptSegment.deleteMany({ where: { projectId } });
    await tx.guideStep.deleteMany({ where: { projectId } });
    await tx.faqItem.deleteMany({ where: { projectId } });
    await tx.reviewFlag.deleteMany({ where: { projectId } });
    for (const [i, { s, idx }] of ordered.entries()) {
      const end = Math.max(s.sourceSec + 1, ordered[i + 1]?.s.sourceSec ?? dur);
      const chapter = content.chapters[s.chapterIndex]?.title ?? content.chapters[0]!.title;
      const redact = content.sensitiveRegions.some((r) => r.stepIndex === idx);
      let warning: string | null = null;
      if (s.warning && !seenWarnings.has(normWarn(s.warning))) { seenWarnings.add(normWarn(s.warning)); warning = s.warning; }
      await tx.scene.create({ data: { projectId, order: i, title: s.title, summary: s.instruction.slice(0, 120), startSec: s.sourceSec, endSec: end, focusZoom: i % 2 === 0, redaction: redact } });
      await tx.scriptSegment.create({ data: { projectId, order: i, startSec: s.sourceSec, endSec: end, originalText: s.transcript, text: s.instruction, origin: "ai", flagged: s.uncertainTerm ?? null } });
      const step = await tx.guideStep.create({ data: { projectId, order: i, chapter, title: s.title, instruction: s.instruction, expectedResult: s.expectedResult ?? null, warning, tip: s.tip ?? null, sourceRef: s.sourceRef ?? null, altText: `Screenshot: ${s.title.toLowerCase()}`, sourceSec: s.sourceSec, origin: "ai", markerX: 30 + ((i * 17) % 45), markerY: 30 + ((i * 23) % 40) } });
      stepIds.set(idx, step.id);
    }
    for (const fl of content.reviewFlags) {
      await tx.reviewFlag.create({ data: { projectId, stepId: fl.stepIndex !== undefined ? stepIds.get(fl.stepIndex) ?? null : null, kind: fl.kind, quote: fl.quote, note: fl.note } });
    }
    for (const f of content.faqs) await tx.faqItem.create({ data: { projectId, question: f.question, answer: f.answer, origin: "ai" } });
    await tx.project.update({ where: { id: projectId }, data: { articleSummary: content.article.summary, articlePurpose: content.article.purpose, prerequisites: content.article.prerequisites || null, aiSuggestions: content.suggestions ? JSON.stringify(content.suggestions) : null } });
  });
}

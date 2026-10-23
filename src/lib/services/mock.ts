// MOCK PROVIDERS — deterministic, offline. No external calls are made in demo mode.
import type {
  AudioTranscriptionService, QuizGenerationService, TextTranslationService,
  GenerationContext, GroundedAnswerService, GuideGenerationService, MalwareScanner, PublishingConnector,
  ScriptGenerationService, StorageAdapter,
} from "./interfaces";

const STOP = new Set(["the", "and", "for", "how", "what", "when", "does", "can", "with", "your", "you", "into", "from", "this", "that", "are", "is", "do", "i", "a", "an", "to", "of", "in", "on", "my"]);
export const tokenize = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 2 && !STOP.has(t));

/** Produces a plausible procedure skeleton from the project context. */
export const mockGuideGenerator: GuideGenerationService = {
  async generate(ctx: GenerationContext) {
    const sys = ctx.sourceSystem || "the application";
    const dur = Math.max(ctx.durationSec, 180);
    const steps = [
      [0, `Open ${sys}`, `Sign in to ${sys} with your own account and open the home page.`, undefined, "Use your own account. Shared logins are not allowed."],
      [0, "Find the right record", `Use the search bar to find the record for "${ctx.title}". Check the reference number before you continue.`],
      [1, "Enter the required details", "Complete the mandatory fields marked with an asterisk. Leave optional fields empty if you don't have the information.", "Don't paste customer personal data into free-text fields."],
      [1, "Review before submitting", "Check the summary panel. Every value should match your source document.", undefined, "Most errors come from swapped dates. Check the day and month order."],
      [2, "Submit and confirm", `Select Submit. ${sys} shows a confirmation with a reference number. Keep it for follow-up.`],
    ] as const;
    return {
      chapters: [{ title: "Getting started" }, { title: "Doing the work" }, { title: "Finishing up" }],
      steps: steps.map(([chapterIndex, title, instruction, warning, tip], i) => ({
        chapterIndex,
        title,
        instruction,
        warning,
        tip,
        expectedResult: `${title} is complete and visible in ${sys}.`,
        sourceSec: Math.round((dur / steps.length) * i) + 4,
        transcript: `Okay so, um, now we ${title.toLowerCase()}. You just ${instruction.charAt(0).toLowerCase()}${instruction.slice(1)}`,
        uncertainTerm: i === 2 ? sys : undefined,
      })),
      faqs: [
        { question: `Who can use this procedure?`, answer: `It's written for ${ctx.audience.toLowerCase()}.` },
        { question: `What if ${sys} is unavailable?`, answer: "Wait 15 minutes and retry. If it's still down, raise an incident with the IT Service Desk." },
      ],
      sensitiveRegions: [{ stepIndex: 2, kind: "email-address" }],
      reviewFlags: [
        // Offline stand-in for the model's risk check: an instruction to ignore errors is always flagged.
        ...(ctx.sourceText?.match(/[^.\n]*\bignore (?:it|them|the errors?|errors?)\b[^.\n]*/i) ?? []).slice(0, 1).map((quote) => ({ kind: "risky" as const, quote: quote.trim(), note: "Following this could hide a real failure. Confirm with the SME what to do when an error appears.", stepIndex: undefined })),
        { stepIndex: 2, kind: "ambiguous" as const, quote: "Leave optional fields empty if you don't have the information.", note: "Which fields are optional depends on the record type. Confirm with the SME." }],
      suggestions: { title: ctx.title.length >= 3 ? ctx.title : `${ctx.title} procedure`, businessFunction: ctx.businessFunction, audience: ctx.audience, classification: "Internal" as const, classificationReason: "Simulated suggestion: no confidential details detected." },
      article: { summary: ctx.description || `How to complete ${ctx.title} in ${sys}.`, purpose: `Give ${ctx.audience.toLowerCase()} one approved way to complete this process.`, prerequisites: `Access to ${sys} with your role.` },
    };
  },
};

export const mockScriptService: ScriptGenerationService = {
  async rewrite(text, instruction, protectedTerms) {
    const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
    let out: string;
    switch (instruction) {
      case "shorten": out = sentences[0] ?? text; break;
      case "simplify": out = text.replace(/\butilise\b|\butilize\b/gi, "use").replace(/\bin order to\b/gi, "to").replace(/\bprior to\b/gi, "before"); break;
      case "professional": out = text.replace(/\b(basically|just|um|uh|so)\b,?\s*/gi, "").replace(/\s{2,}/g, " ").trim(); break;
      case "instructional": out = sentences.map((s) => s.replace(/^(you (should|can|need to) )/i, "")).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" "); break;
      case "expand": out = `${text} When this step is done, check that the screen shows the expected result before moving on.`; break;
    }
    // Protected terms must survive verbatim; if a rewrite dropped one, fall back to the original.
    return protectedTerms.every((t) => !text.includes(t) || out.includes(t)) ? out : text;
  },
};

/** Grounded answers: compose only from supplied evidence; never invent steps. */
export const mockGroundedAnswer: GroundedAnswerService = {
  async answer(question, evidence) {
    const q = tokenize(question);
    if (!q.length || !evidence.length) return { answer: null, sufficient: false, citations: [] };
    const scored = evidence
      .map((e) => ({ e, score: q.filter((t) => e.text.toLowerCase().includes(t)).length / q.length }))
      .filter((x) => x.score >= 0.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);
    if (!scored.length) return { answer: null, sufficient: false, citations: [] };
    return {
      answer: scored.map((x, i) => `${x.e.text.split("\n")[1] ?? x.e.text} [${i + 1}]`).join(" "),
      sufficient: true,
      citations: scored.map((x) => ({ projectId: x.e.projectId, stepId: x.e.stepId })),
    };
  },
};

const mockConnector = (key: string): PublishingConnector => ({
  key,
  simulated: true,
  async publish(input) {
    return { status: "succeeded", simulated: true, externalRef: `mock://${key}/${input.projectId}/v${input.version}`, message: `Simulated publication to ${input.target}. No external system was contacted.` };
  },
});
export const mockConnectors: Record<string, PublishingConnector> = Object.fromEntries(
  ["sharepoint", "stream", "teams", "leonardo", "knowzy", "portal", "package"].map((k) => [k, mockConnector(k)]),
);

export const mockScanner: MalwareScanner = { async scan() { return "clean"; } };
export const mockStorage: StorageAdapter = {
  async putMetadata({ workspaceId, region, fileName }) {
    const safe = fileName.replace(/[^\w.-]+/g, "_").slice(0, 80);
    return { storageKey: `mock-${region.toLowerCase().replace(/\W+/g, "-")}/${workspaceId}/${Date.now()}-${safe}` };
  },
};

export const mockQuiz: QuizGenerationService = {
  async generate({ steps }) {
    return {
      questions: steps.slice(0, 3).map((st, i) => ({
        kind: "single" as const,
        question: `What do you do at the step “${st.title}”?`,
        options: [st.instruction, "Skip this step and continue", "Ask a colleague to do it for you"],
        correct: [0],
        explanation: `The procedure says: ${st.instruction}`,
        difficulty: "easy" as const,
        objective: `Recall step ${i + 1}`,
        sourceStepOrder: st.order,
      })),
    };
  },
};

/** Simulated translation: marks text instead of translating it, so it can't be mistaken for real output. */
export const mockTranslator: TextTranslationService = {
  async translate({ texts, to }) { return texts.map((t) => `[${to.toUpperCase()} · simulated] ${t}`); },
};

export const mockTranscriber: AudioTranscriptionService = {
  available: false,
  async transcribe() { throw new Error("Transcription is not available in simulated mode."); },
};

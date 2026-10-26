// EL Knowledge Studio services backed by OpenAI (Codex). Each one sends a framed, versioned
// prompt with a strict schema and validates the answer before anything is stored.
import { z } from "zod";
import { generatedContentSchema, quizSchema, type GenerationContext, type GroundedAnswerService, type GuideGenerationService, type QuizGenerationService, type ScriptGenerationService, type TextTranslationService } from "../interfaces";
import { BUSINESS_FUNCTIONS, CLASSIFICATIONS, languageLabel } from "@/lib/domain/constants";
import { PROMPTS } from "../prompts";
import { callStructured, type ClientDeps } from "./client";

const str = { type: "string" } as const;
const nstr = { type: ["string", "null"] } as const;
const int = { type: "integer" } as const;
const obj = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });

/** Source material is wrapped and labelled as data, so instructions inside it are not followed. */
const frameSource = (label: string, text: string) => `<source label="${label}">\n${text.replace(/<\/?source[^>]*>/gi, "")}\n</source>`;

const fill = (template: string, vars: Record<string, string>) => template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "");

// --- Guide generation ---------------------------------------------------------------------

const GUIDE_SCHEMA = obj({
  chapters: { type: "array", items: obj({ title: str }) },
  steps: {
    type: "array",
    items: obj({ chapterIndex: int, title: str, instruction: str, expectedResult: nstr, warning: nstr, tip: nstr, sourceSec: int, sourceRef: nstr, transcript: str, uncertainTerm: nstr }),
  },
  faqs: { type: "array", items: obj({ question: str, answer: str }) },
  sensitiveRegions: { type: "array", items: obj({ stepIndex: int, kind: str }) },
  article: obj({ summary: str, purpose: str, prerequisites: str }),
  reviewFlags: { type: "array", items: obj({ stepIndex: { type: ["integer", "null"] }, kind: { type: "string", enum: ["risky", "ambiguous", "typo", "missing-info", "contradiction"] }, quote: str, note: str }) },
  suggestions: obj({ title: str, businessFunction: { type: "string", enum: [...BUSINESS_FUNCTIONS] }, audience: str, classification: { type: "string", enum: [...CLASSIFICATIONS] }, classificationReason: str }),
});

/** Strict schemas send optional fields as null; the domain schema uses undefined. */
const nullsToUndefined = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(nullsToUndefined) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, nullsToUndefined(x)])) : v;

export function openAIGuideGenerator(deps?: ClientDeps): GuideGenerationService {
  return {
    async generate(ctx: GenerationContext & { sourceText?: string }) {
      const p = PROMPTS["guide.generate@2"];
      const isDoc = ctx.sourceType === "document";
      const result = await callStructured(
        {
          schemaName: "el_guide",
          jsonSchema: GUIDE_SCHEMA,
          system: fill(p.system, { protectedTerms: ctx.protectedTerms.join(", ") || "(none)" }),
          user: [
            `Title: ${ctx.title}`,
            `Business function: ${ctx.businessFunction}`,
            `Source system: ${ctx.sourceSystem}`,
            `Audience: ${ctx.audience}`,
            `Language: ${ctx.primaryLanguage}`,
            isDoc ? "Source type: DOCUMENT. There is no recording: set sourceSec to 0 for every step and set sourceRef to the page, slide or heading the step comes from." : `Source type: RECORDING. Duration (seconds): ${ctx.durationSec}. Set sourceRef to null.`,
            `Allowed business functions: ${BUSINESS_FUNCTIONS.join(", ")}.`,
            frameSource("creator-notes", ctx.description),
            ctx.sourceText ? frameSource(isDoc ? "document" : "transcript", ctx.sourceText) : "",
          ].filter(Boolean).join("\n"),
          parse: (raw) => generatedContentSchema.parse(nullsToUndefined(raw)),
        },
        deps,
      );
      return { ...result.value, provenance: { provider: "openai", model: result.modelId, promptVersion: p.version, inputTokens: result.inputTokens, outputTokens: result.outputTokens } };
    },
  };
}

// --- Script rewrite -----------------------------------------------------------------------

const INSTRUCTIONS = {
  shorten: "Shorten it to the essential instruction.",
  expand: "Expand it slightly with the expected result, without adding new actions.",
  simplify: "Use plain words and short sentences for a non-native reader.",
  professional: "Remove filler words and make it sound professional.",
  instructional: "Rewrite it as direct, imperative instructions.",
} as const;

export function openAIScriptService(deps?: ClientDeps): ScriptGenerationService {
  return {
    async rewrite(text, instruction, protectedTerms) {
      const p = PROMPTS["script.rewrite@1"];
      const result = await callStructured(
        {
          schemaName: "el_script_rewrite",
          jsonSchema: obj({ text: str }),
          system: fill(p.system, { protectedTerms: protectedTerms.join(", ") || "(none)" }),
          user: `${INSTRUCTIONS[instruction]}\n${frameSource("script-paragraph", text)}`,
          parse: (raw) => z.object({ text: z.string().min(1) }).parse(raw).text,
        },
        deps,
      );
      // A rewrite that drops a protected term is rejected rather than stored.
      return protectedTerms.every((t) => !text.includes(t) || result.value.includes(t)) ? result.value : text;
    },
  };
}

// --- Grounded answers ---------------------------------------------------------------------

export function openAIGroundedAnswer(deps?: ClientDeps): GroundedAnswerService {
  return {
    async answer(question, evidence) {
      if (!evidence.length) return { answer: null, sufficient: false, citations: [] };
      const p = PROMPTS["answer.grounded@1"];
      const result = await callStructured(
        {
          schemaName: "el_grounded_answer",
          jsonSchema: obj({ sufficient: { type: "boolean" }, answer: nstr, citedPassages: { type: "array", items: int } }),
          system: p.system,
          user: [`Question: ${question}`, ...evidence.map((e, i) => frameSource(`passage-${i + 1}`, e.text))].join("\n"),
          parse: (raw) => z.object({ sufficient: z.boolean(), answer: z.string().nullable(), citedPassages: z.array(z.number().int()) }).parse(raw),
        },
        deps,
      );
      const v = result.value;
      const citations = v.citedPassages.map((n) => evidence[n - 1]).filter((e): e is NonNullable<typeof e> => !!e).map((e) => ({ projectId: e.projectId, stepId: e.stepId }));
      // An answer with no valid citation is treated as insufficient: never show ungrounded text.
      if (!v.sufficient || !v.answer || !citations.length) return { answer: null, sufficient: false, citations: [] };
      return { answer: v.answer, sufficient: true, citations };
    },
  };
}

// --- Quiz generation ----------------------------------------------------------------------

const QUIZ_SCHEMA = obj({
  questions: {
    type: "array",
    items: obj({
      kind: { type: "string", enum: ["single", "multiple", "true-false", "sequence"] },
      question: str,
      options: { type: "array", items: str },
      correct: { type: "array", items: int },
      explanation: str,
      difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
      objective: str,
      sourceStepOrder: int,
    }),
  },
});

export function openAIQuizService(deps?: ClientDeps): QuizGenerationService {
  return {
    async generate({ title, steps, language, flagged = [] }) {
      const p = PROMPTS["quiz.generate@1"];
      const result = await callStructured(
        {
          schemaName: "el_quiz",
          jsonSchema: QUIZ_SCHEMA,
          system: p.system,
          user: [`Procedure: ${title}`, `Write the questions in ${languageLabel(language)}.`, flagged.length ? `<flagged>\n${flagged.join("\n")}\n</flagged>` : "", ...steps.map((s) => frameSource(`step-${s.order}`, `${s.title}\n${s.instruction}${s.warning ? `\nWarning: ${s.warning}` : ""}`))].join("\n"),
          parse: (raw) => quizSchema.parse(raw),
        },
        deps,
      );
      return result.value;
    },
  };
}

// --- Translation --------------------------------------------------------------------------

export function openAITranslator(deps?: ClientDeps): TextTranslationService {
  return {
    async translate({ texts, from, to, protectedTerms }) {
      if (!texts.length) return [];
      const p = PROMPTS["translate@1"];
      const result = await callStructured(
        {
          schemaName: "el_translation",
          jsonSchema: obj({ translations: { type: "array", items: str } }),
          system: fill(p.system, { protectedTerms: protectedTerms.join(", ") || "(none)" }),
          user: [`Translate from ${languageLabel(from)} to ${languageLabel(to)}. Return exactly ${texts.length} translations in the same order.`, ...texts.map((t, i) => frameSource(`segment-${i + 1}`, t))].join("\n"),
          parse: (raw) => {
            const v = z.object({ translations: z.array(z.string()) }).parse(raw).translations;
            if (v.length !== texts.length) throw new Error("count mismatch");
            return v;
          },
        },
        deps,
      );
      // A translation that drops a protected term is replaced by the source text for human review.
      return result.value.map((t, i) => (protectedTerms.every((term) => !texts[i]!.includes(term) || t.includes(term)) ? t : texts[i]!));
    },
  };
}

/** Studio: which lines read from the screen contain personal data, and the exact parts to blur. */
export async function openAIScreenPii(lines: string[], deps?: ClientDeps): Promise<{ line: number; parts: string[] }[]> {
  if (!lines.length) return [];
  const p = PROMPTS["pii.screen@1"];
  const result = await callStructured(
    {
      schemaName: "el_screen_pii",
      jsonSchema: obj({ findings: { type: "array", items: obj({ line: { type: "integer" }, parts: { type: "array", items: str } }) } }),
      system: p.system,
      user: ["Lines, numbered from 0:", frameSource("screen-text", lines.map((l, i) => `${i}: ${l}`).join("\n"))].join("\n"),
      parse: (raw) => z.object({ findings: z.array(z.object({ line: z.number().int(), parts: z.array(z.string()) })) }).parse(raw).findings,
    },
    deps,
  );
  // Only parts that really occur in their line are kept (the model must not invent text).
  return result.value.filter((f) => lines[f.line] !== undefined).map((f) => ({ line: f.line, parts: f.parts.filter((x) => x && lines[f.line]!.includes(x)) })).filter((f) => f.parts.length);
}

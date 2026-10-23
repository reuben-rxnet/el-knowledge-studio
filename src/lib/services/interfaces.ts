// External-service contracts. UI and application services depend on these interfaces only.
// Mock implementations live in ./mock; Azure-oriented stubs in ./azure. Selection: ./registry.ts.
import { z } from "zod";

export interface GenerationContext {
  title: string;
  description: string;
  businessFunction: string;
  sourceSystem: string;
  audience: string;
  primaryLanguage: string;
  durationSec: number;
  /** Terms that must be preserved verbatim (product and system names). */
  protectedTerms: string[];
  /** Extracted document text or transcript. Treated as data, never as instructions. */
  sourceText?: string;
  /** document: cite pages/sections, no timestamps. recording: cite timestamps. */
  sourceType?: "recording" | "document";
}

/** Typed AI output. Every AI response is validated against this before it is stored. */
export const generatedContentSchema = z.object({
  chapters: z.array(z.object({ title: z.string().min(1) })).min(1),
  steps: z
    .array(
      z.object({
        chapterIndex: z.number().int().nonnegative(),
        title: z.string().min(1).max(160),
        instruction: z.string().min(1),
        expectedResult: z.string().optional(),
        warning: z.string().optional(),
        tip: z.string().optional(),
        sourceSec: z.number().int().nonnegative(),
        transcript: z.string().min(1),
        uncertainTerm: z.string().optional(),
        sourceRef: z.string().max(80).optional(),
      }),
    )
    .min(1),
  faqs: z.array(z.object({ question: z.string(), answer: z.string() })),
  sensitiveRegions: z.array(z.object({ stepIndex: z.number().int(), kind: z.string() })),
  article: z.object({ summary: z.string().min(1), purpose: z.string().min(1), prerequisites: z.string() }),
  reviewFlags: z.array(z.object({
    stepIndex: z.number().int().nonnegative().optional(),
    kind: z.enum(["risky", "ambiguous", "typo", "missing-info", "contradiction"]),
    quote: z.string().min(1).max(400),
    note: z.string().min(1).max(400),
  })).default([]),
  suggestions: z.object({
    title: z.string().min(3).max(140),
    businessFunction: z.string().min(1),
    audience: z.string().min(1).max(120),
    classification: z.enum(["Public", "Internal", "Confidential", "Highly Confidential", "Restricted"]),
    classificationReason: z.string().min(1).max(300),
  }).optional(),
});
export type GeneratedContent = z.infer<typeof generatedContentSchema>;

export const quizSchema = z.object({
  questions: z.array(z.object({
    kind: z.enum(["single", "multiple", "true-false", "sequence"]),
    question: z.string().min(1),
    options: z.array(z.string().min(1)).min(2).max(6),
    correct: z.array(z.number().int().nonnegative()).min(1),
    explanation: z.string().min(1),
    difficulty: z.enum(["easy", "medium", "hard"]),
    objective: z.string().min(1),
    sourceStepOrder: z.number().int().nonnegative(),
  }).refine((q) => q.correct.every((i) => i < q.options.length), { message: "correct index out of range" })).min(1),
});
export type GeneratedQuiz = z.infer<typeof quizSchema>;

export interface QuizGenerationService { generate(input: { title: string; steps: { order: number; title: string; instruction: string; warning?: string | null }[]; language: string; flagged?: string[] }): Promise<GeneratedQuiz> }

/** Translates an ordered list of strings; returns the same number of strings in the same order. */
export interface TextTranslationService { translate(input: { texts: string[]; from: string; to: string; protectedTerms: string[] }): Promise<string[]> }

export interface AudioTranscriptionService {
  readonly available: boolean;
  transcribe(input: { file: Blob; fileName: string; language?: string }): Promise<{ text: string; segments: { startSec: number; endSec: number; text: string }[] }>;
}

export interface TranscriptionService { transcribe(sourceKey: string, language: string): Promise<{ startSec: number; endSec: number; text: string }[]> }
export interface ScriptGenerationService { rewrite(text: string, instruction: "shorten" | "expand" | "simplify" | "professional" | "instructional", protectedTerms: string[]): Promise<string> }
export interface GuideGenerationService { generate(ctx: GenerationContext): Promise<unknown> }
export interface SensitiveDataDetectionService { detect(text: string): Promise<{ kind: string; start: number; end: number }[]> }
export interface TranslationService { translate(texts: string[], from: string, to: string, glossary: string[]): Promise<string[]> }
export interface TextToSpeechService { synthesize(text: string, voice: string, language: string): Promise<{ audioKey: string; durationSec: number }> }

export interface SearchHit { projectId: string; kind: "step" | "scene" | "article"; refId: string; score: number }
export interface SearchIndexService { query(text: string, filter: { workspaceIds: string[] }): Promise<SearchHit[]> }

export interface GroundedAnswer { answer: string | null; sufficient: boolean; citations: { projectId: string; stepId: string }[] }
export interface GroundedAnswerService { answer(question: string, evidence: { projectId: string; stepId: string; text: string }[]): Promise<GroundedAnswer> }

export interface PublishResult { status: "succeeded" | "failed"; simulated: boolean; externalRef: string; message: string }
export interface PublishingConnector {
  readonly key: string;
  readonly simulated: boolean;
  publish(input: { projectId: string; title: string; version: number; language: string; target: string; audience: string }): Promise<PublishResult>;
}

export interface MalwareScanner { scan(storageKey: string): Promise<"clean" | "blocked"> }
export interface StorageAdapter { putMetadata(input: { workspaceId: string; region: string; fileName: string }): Promise<{ storageKey: string }> }

import "server-only";
import type { Classification } from "@/lib/domain/constants";
import { AppError } from "@/lib/utilities/errors";
import type { AudioTranscriptionService, GroundedAnswerService, GuideGenerationService, PublishingConnector, QuizGenerationService, ScriptGenerationService, TextTranslationService } from "./interfaces";
import { mockConnectors, mockGroundedAnswer, mockGuideGenerator, mockQuiz, mockScanner, mockScriptService, mockStorage, mockTranscriber, mockTranslator } from "./mock";
import { openAITranscriber } from "./openai/audio";
import { loadOpenAIConfig, OpenAIConfigError } from "./openai/config";
import { openAIGroundedAnswer, openAIGuideGenerator, openAIQuizService, openAIScriptService, openAITranslator } from "./openai/services";

/** AI_PROVIDER=mock (default, offline) | openai (Codex through the configured endpoint/gateway). */
export const aiProviderId = (): "mock" | "openai" => (process.env.AI_PROVIDER === "openai" ? "openai" : "mock");

/** Classifications whose content may be sent to an external model. */
const AI_ALLOWED: Classification[] = ["Public", "Internal", "Confidential"];

/**
 * Gate before any external AI call: provider configured, a data-processing approval recorded,
 * and a classification that permits external processing. Fails closed with a typed error.
 */
export function assertExternalAiAllowed(classification: string) {
  if (aiProviderId() === "mock") return;
  let approvalRef: string | null;
  try { approvalRef = loadOpenAIConfig().approvalRef; } catch (e) {
    throw new AppError("INVALID_STATE", e instanceof OpenAIConfigError ? e.message : "The AI provider is not configured.");
  }
  if (!approvalRef) throw new AppError("INVALID_STATE", "External AI processing is blocked until a data-processing approval is recorded (AI_DATA_PROCESSING_APPROVAL_REF).");
  if (!AI_ALLOWED.includes(classification as Classification)) {
    throw new AppError("CLASSIFICATION_BLOCKED", `${classification} content can't be sent to an external AI model. Use a lower classification or edit manually.`);
  }
}

export const services = {
  guide(): GuideGenerationService { return aiProviderId() === "openai" ? openAIGuideGenerator() : mockGuideGenerator; },
  script(): ScriptGenerationService { return aiProviderId() === "openai" ? openAIScriptService() : mockScriptService; },
  answer(): GroundedAnswerService { return aiProviderId() === "openai" ? openAIGroundedAnswer() : mockGroundedAnswer; },
  quiz(): QuizGenerationService { return aiProviderId() === "openai" ? openAIQuizService() : mockQuiz; },
  translator(): TextTranslationService { return aiProviderId() === "openai" ? openAITranslator() : mockTranslator; },
  transcriber(): AudioTranscriptionService { return aiProviderId() === "openai" ? openAITranscriber() : mockTranscriber; },
  scanner: mockScanner,
  storage: mockStorage,
  connector(key: string): PublishingConnector | undefined {
    // Production connectors (Microsoft Graph etc.) are registered here when MOCK_PUBLISHING_CONNECTORS=false.
    return process.env.MOCK_PUBLISHING_CONNECTORS !== "false" ? mockConnectors[key] : undefined;
  },
  /** For labelling the UI honestly. */
  describe() {
    if (aiProviderId() === "mock") return { provider: "mock" as const, label: "Simulated AI (offline)", model: null };
    try { const c = loadOpenAIConfig(); return { provider: "openai" as const, label: "OpenAI Codex", model: c.modelId }; }
    catch { return { provider: "openai" as const, label: "OpenAI Codex (not configured)", model: null }; }
  },
};

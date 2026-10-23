// OpenAI speech-to-text (POST {base}/audio/transcriptions). Same credential rules as client.ts.
// Codex models don't transcribe audio, so this is OFF unless OPENAI_TRANSCRIBE_MODEL is set to a
// transcription deployment your endpoint exposes (e.g. whisper-1 or gpt-4o-transcribe).
import type { AudioTranscriptionService } from "../interfaces";
import { loadOpenAIConfig, revealOpenAIKey, type OpenAIConfig } from "./config";
import { OpenAIError } from "./client";
import { classifyTransportError, endpointPermission, providerFetch } from "./provider-request";

/** The OpenAI transcription API accepts files up to 25 MB. */
export const TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024;

export function transcriptionModel(env: Record<string, string | undefined> = process.env) {
  return env.OPENAI_TRANSCRIBE_MODEL?.trim() || null;
}

export function openAITranscriber(deps: { config?: OpenAIConfig; revealKey?: () => string; fetch?: typeof fetch; model?: string | null } = {}): AudioTranscriptionService {
  const model = deps.model === undefined ? transcriptionModel() : deps.model;
  return {
    available: !!model,
    async transcribe({ file, fileName, language }) {
      if (!model) throw new OpenAIError("No transcription model is configured (OPENAI_TRANSCRIBE_MODEL).", null, "TRANSCRIPTION_NOT_CONFIGURED", false);
      if (file.size > TRANSCRIBE_MAX_BYTES) throw new OpenAIError("The recording is larger than 25 MB, the transcription limit. Trim it or record shorter segments.", 413, "FILE_TOO_LARGE", false);
      const cfg = deps.config ?? loadOpenAIConfig();
      const base = process.env.OPENAI_TRANSCRIBE_BASE_URL?.trim() || cfg.baseUrl;
      const permission = endpointPermission(base, cfg.allowedHosts);
      if (!permission.allowed) throw new OpenAIError(permission.reason, 403, "ENDPOINT_NOT_ALLOWED", false);

      const verbose = model.startsWith("whisper");
      const form = new FormData();
      form.set("file", file, fileName);
      form.set("model", model);
      form.set("response_format", verbose ? "verbose_json" : "json");
      if (language) form.set("language", language);

      let res: Response;
      try {
        res = await providerFetch({ baseUrl: base, allowedHosts: cfg.allowedHosts, auth: cfg.auth, extraHeaders: cfg.extraHeaders, revealKey: deps.revealKey ?? (() => revealOpenAIKey()) }, permission.url, "/audio/transcriptions", { method: "POST", body: form, timeoutMs: cfg.timeoutMs, fetch: deps.fetch });
      } catch (error) {
        const f = classifyTransportError(error, permission.url.hostname, cfg.timeoutMs);
        throw new OpenAIError(f.detail, null, f.cause, f.cause === "TIMEOUT" || f.cause === "CONNECTION_RESET");
      }
      if (!res.ok) {
        // The provider's message is never kept; only status. 404 usually means the gateway has no audio route.
        throw new OpenAIError(res.status === 404 ? "The AI endpoint has no transcription route. Ask the gateway team for an audio deployment, or unset OPENAI_TRANSCRIBE_MODEL." : `Transcription failed (${res.status}).`, res.status, res.status === 404 ? "TRANSCRIPTION_ROUTE_MISSING" : `HTTP_${res.status}`, res.status === 429 || res.status >= 500);
      }
      const body = (await res.json().catch(() => null)) as { text?: unknown; segments?: { start?: unknown; end?: unknown; text?: unknown }[] } | null;
      if (!body || typeof body.text !== "string") throw new OpenAIError("The transcription response was not readable.", null, "MALFORMED_OUTPUT", false);
      const segments = Array.isArray(body.segments)
        ? body.segments.filter((s) => typeof s.text === "string").map((s) => ({ startSec: Math.floor(Number(s.start) || 0), endSec: Math.ceil(Number(s.end) || 0), text: String(s.text).trim() }))
        : [];
      return { text: body.text.trim(), segments };
    },
  };
}

// OpenAI (Codex) structured-output client. Ported from Knowzy (OPENAI-CODEX-01).
//
// Two API styles: RESPONSES (POST {base}/responses — the only API Codex models are served on) and
// CHAT_COMPLETIONS (POST {base}/chat/completions — what many gateways pass through).
// Every call: strict JSON schema, no tools, store=false. The provider's error MESSAGE is never kept
// (OpenAI's 401 quotes a masked key) — only its status and code.
// Retry policy: 429, 5xx, timeouts and connection resets are retried; MALFORMED_OUTPUT is not
// (the tokens are spent, and a retry could pay twice).
import { loadOpenAIConfig, revealOpenAIKey, type OpenAIConfig } from "./config";
import { classifyTransportError, endpointPermission, providerFetch } from "./provider-request";

export class OpenAIError extends Error {
  constructor(message: string, readonly status: number | null, readonly code: string, readonly retryable: boolean) {
    super(message);
    this.name = "OpenAIError";
  }
}

const IDENTIFIER = /^[a-z0-9_.-]{1,64}$/i;
async function errorCode(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown; type?: unknown } };
    const code = body.error?.code ?? body.error?.type;
    return typeof code === "string" && IDENTIFIER.test(code) ? code : null;
  } catch { return null; }
}

interface Read { text: string | null; refusal: string | null; inputTokens: number | null; outputTokens: number | null; servedModel: string | null }

export function readResponses(body: Record<string, unknown>): Read {
  const usage = body["usage"] as { input_tokens?: unknown; output_tokens?: unknown } | undefined;
  let text: string | null = null;
  let refusal: string | null = null;
  for (const item of Array.isArray(body["output"]) ? (body["output"] as unknown[]) : []) {
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content as { type?: unknown; text?: unknown; refusal?: unknown }[]) {
      if (part.type === "output_text" && typeof part.text === "string") text = (text ?? "") + part.text;
      if (part.type === "refusal" && typeof part.refusal === "string") refusal = part.refusal;
    }
  }
  if (text === null && typeof body["output_text"] === "string") text = body["output_text"];
  return { text, refusal, inputTokens: typeof usage?.input_tokens === "number" ? usage.input_tokens : null, outputTokens: typeof usage?.output_tokens === "number" ? usage.output_tokens : null, servedModel: typeof body["model"] === "string" ? body["model"] : null };
}

export function readChat(body: Record<string, unknown>): Read {
  const usage = body["usage"] as { prompt_tokens?: unknown; completion_tokens?: unknown } | undefined;
  const choice = Array.isArray(body["choices"]) ? (body["choices"][0] as { message?: { content?: unknown; refusal?: unknown } } | undefined) : undefined;
  return {
    text: typeof choice?.message?.content === "string" ? choice.message.content : null,
    refusal: typeof choice?.message?.refusal === "string" ? choice.message.refusal : null,
    inputTokens: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : null,
    outputTokens: typeof usage?.completion_tokens === "number" ? usage.completion_tokens : null,
    servedModel: typeof body["model"] === "string" ? body["model"] : null,
  };
}

export interface StructuredCall<T> {
  schemaName: string;
  /** A strict JSON schema: object root, every property required, optional ones nullable. */
  jsonSchema: Record<string, unknown>;
  system: string;
  user: string;
  parse: (raw: unknown) => T;
}

export interface StructuredResult<T> { value: T; modelId: string; inputTokens: number | null; outputTokens: number | null; attempts: number }

export interface ClientDeps { config?: OpenAIConfig; revealKey?: () => string; fetch?: typeof fetch; maxAttempts?: number; sleep?: (ms: number) => Promise<void> }

async function callOnce<T>(cfg: OpenAIConfig, revealKey: () => string, call: StructuredCall<T>, fetchImpl?: typeof fetch): Promise<Omit<StructuredResult<T>, "attempts">> {
  const permission = endpointPermission(cfg.baseUrl, cfg.allowedHosts);
  if (!permission.allowed) throw new OpenAIError(permission.reason, 403, "ENDPOINT_NOT_ALLOWED", false);

  const schema = { name: call.schemaName, strict: true, schema: call.jsonSchema };
  const body = cfg.apiStyle === "RESPONSES"
    ? { model: cfg.modelId, instructions: call.system, input: call.user, text: { format: { type: "json_schema", ...schema } }, tools: [], store: false, ...(cfg.maxOutputTokens ? { max_output_tokens: cfg.maxOutputTokens } : {}) }
    : { model: cfg.modelId, messages: [{ role: "system", content: call.system }, { role: "user", content: call.user }], response_format: { type: "json_schema", json_schema: schema }, ...(cfg.maxOutputTokens ? { max_completion_tokens: cfg.maxOutputTokens } : {}) };

  let response: Response;
  try {
    response = await providerFetch({ baseUrl: cfg.baseUrl, allowedHosts: cfg.allowedHosts, auth: cfg.auth, extraHeaders: cfg.extraHeaders, revealKey }, permission.url, cfg.apiStyle === "RESPONSES" ? "/responses" : "/chat/completions", { method: "POST", body: JSON.stringify(body), timeoutMs: cfg.timeoutMs, fetch: fetchImpl });
  } catch (error) {
    const f = classifyTransportError(error, permission.url.hostname, cfg.timeoutMs);
    throw new OpenAIError(f.detail, null, f.cause, f.cause === "TIMEOUT" || f.cause === "CONNECTION_RESET" || f.cause === "UNREACHABLE");
  }

  if (!response.ok) {
    const code = await errorCode(response);
    const retryable = response.status === 429 || response.status >= 500;
    throw new OpenAIError(`The AI provider answered ${response.status}${code ? ` (${code})` : ""}.`, response.status, response.status === 429 ? "RATE_LIMITED" : code ?? `HTTP_${response.status}`, retryable);
  }

  let parsed: Record<string, unknown>;
  try { parsed = (await response.json()) as Record<string, unknown>; } catch { throw new OpenAIError("The AI provider returned a body that is not JSON.", null, "MALFORMED_OUTPUT", false); }
  const read = cfg.apiStyle === "RESPONSES" ? readResponses(parsed) : readChat(parsed);
  if (read.refusal !== null) throw new OpenAIError(`The model declined: ${read.refusal.slice(0, 200)}`, null, "MODEL_REFUSED", false);
  if (read.text === null) throw new OpenAIError("The AI provider returned no output text.", null, "MALFORMED_OUTPUT", false);

  let value: T;
  try { value = call.parse(JSON.parse(read.text)); } catch { throw new OpenAIError("The model's output did not match the expected schema. It was not saved.", null, "MALFORMED_OUTPUT", false); }
  // Record what the provider SERVED (a dated snapshot), not only the configured alias.
  return { value, modelId: read.servedModel ?? cfg.modelId, inputTokens: read.inputTokens, outputTokens: read.outputTokens };
}

export async function callStructured<T>(call: StructuredCall<T>, deps: ClientDeps = {}): Promise<StructuredResult<T>> {
  const cfg = deps.config ?? loadOpenAIConfig();
  const revealKey = deps.revealKey ?? (() => revealOpenAIKey());
  const maxAttempts = deps.maxAttempts ?? 3;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      return { ...(await callOnce(cfg, revealKey, call, deps.fetch)), attempts: attempt };
    } catch (error) {
      if (!(error instanceof OpenAIError) || !error.retryable || attempt >= maxAttempts) throw error;
      await sleep(500 * 2 ** (attempt - 1));
    }
  }
}

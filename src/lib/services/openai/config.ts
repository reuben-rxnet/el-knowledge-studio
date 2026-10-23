// OpenAI (Codex) configuration from the environment, validated at call time.
// Mirrors Knowzy's provider settings: base URL, model, API style, auth location, fixed headers,
// and a deployment-level host allow-list. The key is read only when a request is sent.
import { z } from "zod";
import type { ProviderAuth } from "./provider-request";

export const OPENAI_API_STYLES = ["RESPONSES", "CHAT_COMPLETIONS"] as const;
export type OpenAIApiStyle = (typeof OPENAI_API_STYLES)[number];

/** Header names that must never be configured as "extra" (non-secret) headers. */
const FORBIDDEN_HEADER = /^(authorization|cookie|proxy-authorization|host|content-length|content-type|connection|transfer-encoding)$|api-key|subscription-key|token|secret|credential|password/i;

/** `NAME=` in a .env file means "not set", not an empty string or 0. */
const emptyAsUnset = (env: Record<string, string | undefined>) =>
  Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ""));

const envSchema = z.object({
  OPENAI_BASE_URL: z.string().url("OPENAI_BASE_URL must be a URL."),
  OPENAI_MODEL: z.string().min(1, "OPENAI_MODEL is required (the deployment name)."),
  OPENAI_API_STYLE: z.enum(OPENAI_API_STYLES).default("RESPONSES"),
  OPENAI_AUTH_LOCATION: z.enum(["HEADER", "QUERY_PARAMETER"]).default("HEADER"),
  OPENAI_AUTH_HEADER_NAME: z.string().default("authorization"),
  OPENAI_AUTH_QUERY_PARAMETER: z.string().optional(),
  OPENAI_EXTRA_HEADERS: z.string().default(""),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  OPENAI_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().optional(),
  LLM_ENDPOINT_ALLOWLIST: z.string().default(""),
  AI_DATA_PROCESSING_APPROVAL_REF: z.string().optional(),
});

export interface OpenAIConfig {
  baseUrl: string;
  modelId: string;
  apiStyle: OpenAIApiStyle;
  auth: ProviderAuth;
  extraHeaders: Record<string, string>;
  allowedHosts: string[];
  timeoutMs: number;
  maxOutputTokens: number | null;
  approvalRef: string | null;
}

export class OpenAIConfigError extends Error {
  readonly code = "AI_PROVIDER_NOT_CONFIGURED";
}

/** "name: value; name2: value2" → record. Credential-shaped and protocol header names are refused. */
export function parseExtraHeaders(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of raw.split(";").map((p) => p.trim()).filter(Boolean)) {
    const i = pair.indexOf(":");
    if (i < 1) throw new OpenAIConfigError(`OPENAI_EXTRA_HEADERS entry "${pair.slice(0, 40)}" is not "name: value".`);
    const name = pair.slice(0, i).trim().toLowerCase();
    const value = pair.slice(i + 1).trim();
    if (FORBIDDEN_HEADER.test(name)) throw new OpenAIConfigError(`OPENAI_EXTRA_HEADERS can't set "${name}". Credentials belong in OPENAI_API_KEY only.`);
    if (!value || /[\r\n]/.test(value)) throw new OpenAIConfigError(`OPENAI_EXTRA_HEADERS "${name}" has an empty or invalid value.`);
    out[name] = value;
  }
  if (Object.keys(out).length > 5) throw new OpenAIConfigError("OPENAI_EXTRA_HEADERS allows at most 5 headers.");
  return out;
}

export function loadOpenAIConfig(env: Record<string, string | undefined> = process.env): OpenAIConfig {
  const parsed = envSchema.safeParse(emptyAsUnset(env));
  if (!parsed.success) throw new OpenAIConfigError(parsed.error.issues.map((i) => i.message).join(" "));
  const e = parsed.data;
  let auth: ProviderAuth;
  if (e.OPENAI_AUTH_LOCATION === "QUERY_PARAMETER") {
    if (!e.OPENAI_AUTH_QUERY_PARAMETER) throw new OpenAIConfigError("OPENAI_AUTH_QUERY_PARAMETER is required when OPENAI_AUTH_LOCATION=QUERY_PARAMETER.");
    auth = { location: "QUERY_PARAMETER", parameterName: e.OPENAI_AUTH_QUERY_PARAMETER };
  } else {
    auth = { location: "HEADER", headerName: e.OPENAI_AUTH_HEADER_NAME };
  }
  return {
    baseUrl: e.OPENAI_BASE_URL,
    modelId: e.OPENAI_MODEL,
    apiStyle: e.OPENAI_API_STYLE,
    auth,
    extraHeaders: parseExtraHeaders(e.OPENAI_EXTRA_HEADERS),
    // api.openai.com is always allowed; gateway hosts come from the deployment, never a screen.
    allowedHosts: ["api.openai.com", ...e.LLM_ENDPOINT_ALLOWLIST.split(",").map((h) => h.trim()).filter(Boolean)],
    timeoutMs: e.OPENAI_TIMEOUT_MS,
    maxOutputTokens: e.OPENAI_MAX_OUTPUT_TOKENS ?? null,
    approvalRef: e.AI_DATA_PROCESSING_APPROVAL_REF?.trim() || null,
  };
}

/** The key, read at the moment of sending. In production this resolves from Azure Key Vault. */
export function revealOpenAIKey(env: Record<string, string | undefined> = process.env): string {
  const key = env.OPENAI_API_KEY?.trim();
  if (!key) throw new OpenAIConfigError("OPENAI_API_KEY is not set.");
  return key;
}

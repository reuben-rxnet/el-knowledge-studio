import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { callStructured, OpenAIError } from "@/lib/services/openai/client";
import { loadOpenAIConfig, parseExtraHeaders, type OpenAIConfig } from "@/lib/services/openai/config";
import { endpointPermission, sanitizeUrl } from "@/lib/services/openai/provider-request";
import { openAIGroundedAnswer } from "@/lib/services/openai/services";

const GATEWAY: OpenAIConfig = {
  baseUrl: "https://dev-apim-ai.luxottica.com/codex/openai/v1",
  modelId: "gpt-5.3-codex_codeassist",
  apiStyle: "RESPONSES",
  auth: { location: "QUERY_PARAMETER", parameterName: "subscription-key" },
  extraHeaders: { "x-openai-supplier": "EssilorLuxottica" },
  allowedHosts: ["api.openai.com", "dev-apim-ai.luxottica.com"],
  timeoutMs: 5000,
  maxOutputTokens: null,
  approvalRef: "PRIV-123",
};
const KEY = "0123456789abcdef0123456789abcdef";
const call = { schemaName: "t", jsonSchema: { type: "object" }, system: "sys", user: "usr", parse: (r: unknown) => z.object({ ok: z.boolean() }).parse(r) };
const responsesBody = (text: string) => ({ model: "gpt-5.3-codex_codeassist-2026-09-01", output: [{ content: [{ type: "output_text", text }] }], usage: { input_tokens: 10, output_tokens: 4 } });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("OpenAI Codex client (Knowzy gateway pattern)", () => {
  it("POSTs to /responses with the key as subscription-key, the fixed header, strict schema and store=false", async () => {
    const fetchMock = vi.fn<(url: URL | RequestInfo, init?: RequestInit) => Promise<Response>>(async () => json(200, responsesBody('{"ok":true}')));
    const r = await callStructured(call, { config: GATEWAY, revealKey: () => KEY, fetch: fetchMock as unknown as typeof fetch });
    const [url, init] = fetchMock.mock.calls[0]!;
    const u = new URL(String(url));
    expect(u.pathname).toBe("/codex/openai/v1/responses");
    expect(u.searchParams.get("subscription-key")).toBe(KEY);
    const headers = init!.headers as Record<string, string>;
    expect(headers["x-openai-supplier"]).toBe("EssilorLuxottica");
    expect(headers["authorization"]).toBeUndefined();
    expect(init!.redirect).toBe("error");
    const body = JSON.parse(String(init!.body));
    expect(body).toMatchObject({ model: "gpt-5.3-codex_codeassist", store: false, tools: [], text: { format: { type: "json_schema", strict: true } } });
    expect(r.value).toEqual({ ok: true });
    expect(r.modelId).toBe("gpt-5.3-codex_codeassist-2026-09-01");
  });

  it("uses Bearer auth and /chat/completions when configured", async () => {
    const fetchMock = vi.fn(async () => json(200, { model: "m", choices: [{ message: { content: '{"ok":false}' } }] }));
    await callStructured(call, { config: { ...GATEWAY, apiStyle: "CHAT_COMPLETIONS", auth: { location: "HEADER", headerName: "authorization" } }, revealKey: () => KEY, fetch: fetchMock as unknown as typeof fetch });
    const [url, init] = (fetchMock.mock.calls[0] as unknown as [URL, RequestInit]);
    expect(new URL(String(url)).pathname.endsWith("/chat/completions")).toBe(true);
    expect((init.headers as Record<string, string>)["authorization"]).toBe(`Bearer ${KEY}`);
  });

  it("refuses a host that is not allow-listed, without sending the key", async () => {
    const fetchMock = vi.fn();
    await expect(callStructured(call, { config: { ...GATEWAY, baseUrl: "https://evil.example.com/v1" }, revealKey: () => KEY, fetch: fetchMock as unknown as typeof fetch })).rejects.toMatchObject({ code: "ENDPOINT_NOT_ALLOWED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses plain http and URLs that carry credentials", () => {
    expect(endpointPermission("http://dev-apim-ai.luxottica.com/v1", GATEWAY.allowedHosts).allowed).toBe(false);
    expect(endpointPermission("https://dev-apim-ai.luxottica.com/v1?subscription-key=x", GATEWAY.allowedHosts).allowed).toBe(false);
  });

  it("retries 429 and 5xx, then succeeds", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(429, { error: { code: "rate_limit" } })).mockResolvedValueOnce(json(503, {})).mockResolvedValueOnce(json(200, responsesBody('{"ok":true}')));
    const r = await callStructured(call, { config: GATEWAY, revealKey: () => KEY, fetch: fetchMock as unknown as typeof fetch, sleep: async () => {} });
    expect(r.attempts).toBe(3);
  });

  it("does not retry malformed output and never keeps the provider's message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, responsesBody("not json")));
    await expect(callStructured(call, { config: GATEWAY, revealKey: () => KEY, fetch: fetchMock as unknown as typeof fetch, sleep: async () => {} })).rejects.toMatchObject({ code: "MALFORMED_OUTPUT" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const leaky = vi.fn().mockResolvedValue(json(401, { error: { code: "invalid_api_key", message: `Incorrect key ${KEY.slice(0, 6)}****` } }));
    const err = await callStructured(call, { config: GATEWAY, revealKey: () => KEY, fetch: leaky as unknown as typeof fetch }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OpenAIError);
    expect((err as Error).message).not.toContain(KEY.slice(0, 6));
    expect((err as OpenAIError).code).toBe("invalid_api_key");
  });

  it("redacts credential query parameters and refuses credential-shaped extra headers", () => {
    expect(sanitizeUrl(`https://h/x?subscription-key=${KEY}&keyword=a`)).toBe("https://h/x?subscription-key=REDACTED&keyword=a");
    expect(parseExtraHeaders("x-openai-supplier: EssilorLuxottica")).toEqual({ "x-openai-supplier": "EssilorLuxottica" });
    expect(() => parseExtraHeaders("api-key: abc")).toThrow();
  });

  it("loads the Knowzy gateway configuration from the environment", () => {
    const c = loadOpenAIConfig({
      OPENAI_BASE_URL: GATEWAY.baseUrl, OPENAI_MODEL: GATEWAY.modelId, OPENAI_AUTH_LOCATION: "QUERY_PARAMETER", OPENAI_AUTH_QUERY_PARAMETER: "subscription-key",
      OPENAI_EXTRA_HEADERS: "x-openai-supplier: EssilorLuxottica", LLM_ENDPOINT_ALLOWLIST: "dev-apim-ai.luxottica.com",
    });
    expect(c.auth).toEqual({ location: "QUERY_PARAMETER", parameterName: "subscription-key" });
    expect(c.allowedHosts).toContain("dev-apim-ai.luxottica.com");
    expect(c.approvalRef).toBeNull();
  });

  it("treats empty .env values as not set", () => {
    const c = loadOpenAIConfig({ OPENAI_BASE_URL: GATEWAY.baseUrl, OPENAI_MODEL: GATEWAY.modelId, OPENAI_MAX_OUTPUT_TOKENS: "", OPENAI_TIMEOUT_MS: "", AI_DATA_PROCESSING_APPROVAL_REF: "  " });
    expect(c.maxOutputTokens).toBeNull();
    expect(c.timeoutMs).toBe(120_000);
    expect(c.approvalRef).toBeNull();
  });

  it("treats an uncited answer as insufficient evidence", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, responsesBody('{"sufficient":true,"answer":"Do X.","citedPassages":[]}')));
    const svc = openAIGroundedAnswer({ config: GATEWAY, revealKey: () => KEY, fetch: fetchMock as unknown as typeof fetch });
    const r = await svc.answer("How?", [{ projectId: "p", stepId: "s", text: "Step text" }]);
    expect(r).toEqual({ answer: null, sufficient: false, citations: [] });
  });
});

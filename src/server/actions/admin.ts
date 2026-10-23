"use server";
import { z } from "zod";
import { assertPermission, requireSession } from "@/lib/auth/session";
import { callStructured, OpenAIError } from "@/lib/services/openai/client";
import { aiProviderId } from "@/lib/services/registry";
import { recordAudit } from "@/server/audit";
import { run, type ActionResult } from "./result";

export interface ConnectionResult { ok: boolean; provider: string; model?: string; ms?: number; code?: string; message: string }

/**
 * Sends one content-free structured request through the same path generation uses
 * (allow-list, auth, fixed headers, strict schema). No project data is sent.
 */
export async function testAiConnection(): Promise<ActionResult<ConnectionResult>> {
  return run(async () => {
    const s = await requireSession();
    assertPermission(s, "workspace.manage");
    if (aiProviderId() === "mock") return { ok: true, provider: "mock", message: "Simulated AI is active (AI_PROVIDER=mock). No external call was made." };
    const started = Date.now();
    let result: ConnectionResult;
    try {
      const r = await callStructured({
        schemaName: "el_connection_test",
        jsonSchema: { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } },
        system: "Reply with ok=true. Respond only with JSON matching the schema.",
        user: "Connection test.",
        parse: (raw) => z.object({ ok: z.boolean() }).parse(raw),
      }, { maxAttempts: 1 });
      result = { ok: r.value.ok, provider: "openai", model: r.modelId, ms: Date.now() - started, message: `Codex answered in ${Date.now() - started} ms.` };
    } catch (e) {
      result = e instanceof OpenAIError
        ? { ok: false, provider: "openai", code: e.code, message: e.message }
        : { ok: false, provider: "openai", code: "CONFIGURATION", message: e instanceof Error ? e.message : "The AI provider isn't configured." };
    }
    await recordAudit(s, { action: "ai.connection.tested", resourceType: "ai-provider", resourceId: "openai", resourceLabel: result.ok ? `Connection OK (${result.model})` : `Connection failed (${result.code})`, outcome: result.ok ? "success" : "failure" });
    return result;
  });
}

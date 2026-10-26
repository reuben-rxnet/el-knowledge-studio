"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission, requireSession } from "@/lib/auth/session";
import { callStructured, OpenAIError } from "@/lib/services/openai/client";
import { aiProviderId } from "@/lib/services/registry";
import { recordAudit } from "@/server/audit";
import { deleteOrphans, findOrphans } from "@/server/cleanup";
import { getUploadLimits, piiCodexEnabled, storePiiCodex, storeUploadLimits, uploadCeilingMb } from "@/server/settings";
import { CATEGORY_META, UPLOAD_CATEGORIES, formatLimit, type UploadCategory, type UploadLimits } from "@/lib/validation/upload-limits";
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

/** Saves the upload limits (MB per file type). Platform administrators only, capped at UPLOAD_CEILING_MB, audited. */
export async function saveUploadLimits(input: Record<string, number>): Promise<ActionResult<UploadLimits>> {
  return run(async () => {
    const s = await requireSession();
    assertPermission(s, "enterprise.manage");
    const ceiling = uploadCeilingMb();
    const mb = z.coerce.number().int("Use whole megabytes.").min(1, "At least 1 MB.").max(ceiling, `At most ${ceiling} MB (the ceiling set for this environment).`);
    const v = z.object(Object.fromEntries(UPLOAD_CATEGORIES.map((c) => [c, mb])) as Record<UploadCategory, typeof mb>).parse(input);
    const before = await getUploadLimits();
    const changed = UPLOAD_CATEGORIES.filter((c) => before[c] !== v[c]);
    if (!changed.length) return before;
    await storeUploadLimits(v, s.user.id);
    // The label records exactly what changed, e.g. "Video 1 GB → 2 GB; Audio 500 MB → 300 MB".
    const label = changed.map((c) => `${CATEGORY_META[c].label} ${formatLimit(before[c])} → ${formatLimit(v[c])}`).join("; ");
    await recordAudit(s, { action: "settings.changed", resourceType: "setting", resourceId: "upload.limits", resourceLabel: `Upload limits: ${label}` });
    revalidatePath("/admin");
    revalidatePath("/create/upload");
    return v;
  });
}

/** Lets Studio's personal-data detection send screen text to Codex. Platform administrators only, audited. */
export async function savePiiCodex(enabled: boolean): Promise<ActionResult<boolean>> {
  return run(async () => {
    const s = await requireSession();
    assertPermission(s, "enterprise.manage");
    const v = z.boolean().parse(enabled);
    if ((await piiCodexEnabled()) === v) return v;
    await storePiiCodex(v, s.user.id);
    await recordAudit(s, { action: "settings.changed", resourceType: "setting", resourceId: "pii.codex", resourceLabel: `Studio personal-data detection: Codex check ${v ? "switched on" : "switched off"}` });
    revalidatePath("/admin");
    return v;
  });
}

export interface UnusedFiles { count: number; totalBytes: number; oldest: string | null }

/** Counts stored files nothing refers to (older than a day). Platform administrators only; read-only. */
export async function findUnusedFiles(): Promise<ActionResult<UnusedFiles>> {
  return run(async () => {
    const s = await requireSession();
    assertPermission(s, "enterprise.manage");
    const r = await findOrphans();
    return { count: r.count, totalBytes: r.totalBytes, oldest: r.oldest?.toISOString() ?? null };
  });
}

/** Deletes those files, checking references again first. Platform administrators only, audited. */
export async function deleteUnusedFiles(): Promise<ActionResult<{ deleted: number; bytes: number; failed: number }>> {
  return run(async () => {
    const s = await requireSession();
    assertPermission(s, "enterprise.manage");
    const r = await deleteOrphans();
    const mb = (r.bytes / 1048576).toFixed(1);
    await recordAudit(s, { action: "storage.cleaned", resourceType: "storage", resourceId: "storage", resourceLabel: `Storage clean-up: ${r.deleted} unused file${r.deleted === 1 ? "" : "s"} deleted (${mb} MB)${r.failed ? `, ${r.failed} couldn't be deleted` : ""}`, outcome: r.failed ? "failure" : "success" });
    revalidatePath("/admin");
    return r;
  });
}

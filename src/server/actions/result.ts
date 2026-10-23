import "server-only";
import { ZodError } from "zod";
import { AuthorizationError } from "@/lib/permissions";
import { newCorrelationId, toApiError, type ApiError } from "@/lib/utilities/errors";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: ApiError; fieldErrors?: Record<string, string> };

/** Runs an action and converts every failure into the consistent error envelope (no stack traces). */
export async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  const correlationId = newCorrelationId();
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    // next/navigation redirect() and notFound() throw control-flow errors that must propagate.
    if (err && typeof err === "object" && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_")) throw err;
    if (err instanceof ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of err.issues) fieldErrors[issue.path.join(".") || "_"] ??= issue.message;
      return { ok: false, error: { code: "VALIDATION_FAILED", message: "Some fields need attention.", correlationId, details: {} }, fieldErrors };
    }
    if (err instanceof AuthorizationError) return { ok: false, error: { code: "PERMISSION_DENIED", message: err.message, correlationId, details: { permission: err.permission } } };
    if (!(err instanceof Error) || !("code" in err)) console.error(`[action] correlation=${correlationId}`, err instanceof Error ? err.name : "unknown");
    return { ok: false, error: toApiError(err, correlationId) };
  }
}

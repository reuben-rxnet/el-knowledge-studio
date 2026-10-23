import { AppError } from "./errors";

/**
 * Per-user (or per-IP) limits on the expensive or abusable operations: AI calls, uploads, renders, sign-in.
 * Sliding window, kept in memory: each app replica counts on its own, so with N replicas the effective
 * limit is up to N times higher. That is acceptable for the pilot (max 3 replicas); move the counters to
 * a shared store (Redis) if the limits must be exact.
 */
export const LIMITS = {
  ai: { limit: 30, windowSec: 600, what: "AI requests" },          // rewrites, answers, regenerations
  generate: { limit: 20, windowSec: 3600, what: "new drafts" },    // create project / regenerate (full pipeline)
  upload: { limit: 30, windowSec: 600, what: "uploads" },
  render: { limit: 10, windowSec: 3600, what: "video renders" },
  feedback: { limit: 10, windowSec: 3600, what: "feedback messages" },
  signIn: { limit: 20, windowSec: 300, what: "sign-in attempts" }, // per IP
} as const;
export type RateBucket = keyof typeof LIMITS;

const MAX_KEYS = 10_000;
const hits = new Map<string, number[]>();

/** Records one use and reports whether it was allowed, without throwing. */
export function takeRate(bucket: RateBucket, id: string, now = Date.now()): { ok: true } | { ok: false; retryAfterSec: number } {
  const { limit, windowSec } = LIMITS[bucket];
  const key = `${bucket}:${id}`;
  const since = now - windowSec * 1000;
  const recent = (hits.get(key) ?? []).filter((t) => t > since);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((recent[0]! + windowSec * 1000 - now) / 1000)) };
  }
  recent.push(now);
  hits.delete(key); // re-insert so the Map's order stays least-recently-used first
  hits.set(key, recent);
  if (hits.size > MAX_KEYS) hits.delete(hits.keys().next().value!);
  return { ok: true };
}

/** Throws a RATE_LIMITED AppError (HTTP 429) when the limit is reached. */
export function enforceRate(bucket: RateBucket, id: string) {
  const r = takeRate(bucket, id);
  if (r.ok) return;
  const minutes = Math.ceil(r.retryAfterSec / 60);
  throw new AppError("RATE_LIMITED", `You've reached the limit for ${LIMITS[bucket].what}. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`, { retryAfterSec: r.retryAfterSec });
}

/** The client address for per-IP limits: the first X-Forwarded-For hop (set by the Azure ingress). */
export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

/** Tests only. */
export const resetRateLimits = () => hits.clear();

import { beforeEach, describe, expect, it } from "vitest";
import { enforceRate, LIMITS, resetRateLimits, takeRate } from "@/lib/utilities/rate-limit";
import { AppError, HTTP_STATUS } from "@/lib/utilities/errors";

describe("rate limits", () => {
  beforeEach(resetRateLimits);

  it("allows up to the limit in a window, then refuses with a retry time", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < LIMITS.render.limit; i++) expect(takeRate("render", "u1", t0 + i).ok).toBe(true);
    const r = takeRate("render", "u1", t0 + 100);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.retryAfterSec).toBe(LIMITS.render.windowSec);
    expect(takeRate("render", "u2", t0 + 100).ok).toBe(true); // per user
    expect(takeRate("upload", "u1", t0 + 100).ok).toBe(true); // per bucket
  });

  it("frees capacity as old uses leave the sliding window", () => {
    const t0 = 5_000_000;
    for (let i = 0; i < LIMITS.signIn.limit; i++) takeRate("signIn", "1.2.3.4", t0);
    expect(takeRate("signIn", "1.2.3.4", t0 + 1000).ok).toBe(false);
    expect(takeRate("signIn", "1.2.3.4", t0 + LIMITS.signIn.windowSec * 1000 + 1).ok).toBe(true);
  });

  it("throws a 429 AppError with a readable message", () => {
    for (let i = 0; i < LIMITS.ai.limit; i++) enforceRate("ai", "u1");
    try { enforceRate("ai", "u1"); expect.unreachable(); } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe("RATE_LIMITED");
      expect(HTTP_STATUS.RATE_LIMITED).toBe(429);
      expect((e as AppError).message).toMatch(/limit for AI requests. Try again in 10 minutes/);
    }
  });
});

"use server";
import { z } from "zod";
import { db } from "@/lib/database/client";
import { requireSession } from "@/lib/auth/session";
import { recordAudit } from "@/server/audit";
import { run, type ActionResult } from "./result";

/** Feedback stores the query and rating only — no answer text, no personal data beyond the user ID. */
export async function rateAnswer(input: { query: string; helpful: boolean; reason?: string }): Promise<ActionResult> {
  return run(async () => {
    const s = await requireSession();
    const v = z.object({ query: z.string().trim().min(1).max(300), helpful: z.boolean(), reason: z.string().trim().max(300).optional() }).parse(input);
    await db.searchFeedback.create({ data: { userId: s.user.id, query: v.query, helpful: v.helpful, reason: v.reason ?? null } });
    await recordAudit(s, { action: "search.feedback", resourceType: "search", resourceId: "knowledge-hub", resourceLabel: v.helpful ? "Answer rated helpful" : "Answer reported as incorrect" });
    return undefined;
  });
}

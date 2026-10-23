"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/database/client";
import { FEEDBACK_CATEGORIES } from "@/lib/domain/constants";
import { assertPermission, requireSession } from "@/lib/auth/session";
import { AppError } from "@/lib/utilities/errors";
import { enforceRate } from "@/lib/utilities/rate-limit";
import { recordAudit } from "@/server/audit";
import { run, type ActionResult } from "./result";

const submitSchema = z.object({
  category: z.enum(FEEDBACK_CATEGORIES),
  message: z.string().trim().min(5, "Write at least a few words.").max(2000, "Keep it under 2,000 characters."),
  page: z.string().trim().max(200).default(""),
});

/** Pilot feedback, stored with the workspace so its administrators can triage it. */
export async function submitFeedback(input: z.input<typeof submitSchema>): Promise<ActionResult> {
  return run(async () => {
    const s = await requireSession();
    const v = submitSchema.parse(input);
    enforceRate("feedback", s.user.id);
    const item = await db.feedbackItem.create({ data: { userId: s.user.id, workspaceId: s.workspace.id, category: v.category, message: v.message, page: v.page } });
    await recordAudit(s, { action: "feedback.submitted", resourceType: "feedback", resourceId: item.id, resourceLabel: v.category });
    revalidatePath("/feedback");
    return undefined;
  });
}

export async function setFeedbackStatus(input: { id: string; status: "new" | "triaged" | "done" }): Promise<ActionResult> {
  return run(async () => {
    const s = await requireSession();
    assertPermission(s, "workspace.manage");
    const v = z.object({ id: z.string().min(1), status: z.enum(["new", "triaged", "done"]) }).parse(input);
    const { count } = await db.feedbackItem.updateMany({ where: { id: v.id, workspaceId: s.workspace.id }, data: { status: v.status } });
    if (!count) throw new AppError("VALIDATION_FAILED", "That feedback item could not be found.");
    revalidatePath("/feedback");
    return undefined;
  });
}

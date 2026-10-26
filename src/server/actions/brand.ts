"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPermission, requireSession } from "@/lib/auth/session";
import { deleteStoredFile } from "@/lib/services/storage";
import { brandTemplateSchema, type BrandTemplate } from "@/lib/studio/brand-template";
import { AppError } from "@/lib/utilities/errors";
import { recordAudit } from "@/server/audit";
import { getUploadedMusic, storeBrandTemplate, storeUploadedMusic } from "@/server/settings";
import { run, type ActionResult } from "./result";

/** Saves Studio's brand template (Brand Center). Applies to renders started from now on. */
export async function saveBrandTemplate(input: BrandTemplate): Promise<ActionResult<BrandTemplate>> {
  return run(async () => {
    const s = await requireSession();
    assertPermission(s, "brand.manage");
    const t = brandTemplateSchema.parse(input);
    await storeBrandTemplate(t, s.user.id);
    await recordAudit(s, { action: "settings.changed", resourceType: "brand-template", resourceId: "studio.brand", resourceLabel: `Studio brand template: ${t.accent} accent, intro ${t.introSec} s, outro ${t.outroSec} s, captions ${t.captionSize} ${t.captionColor}` });
    revalidatePath("/brand");
    return t;
  });
}

/** Removes an uploaded music track. Edits that chose it render without music until another is picked. */
export async function removeMusicTrack(input: { id: string }): Promise<ActionResult<{ removed: boolean }>> {
  return run(async () => {
    const s = await requireSession();
    assertPermission(s, "brand.manage");
    const id = z.string().regex(/^up-[\w-]{1,40}$/).parse(input.id);
    const list = await getUploadedMusic();
    const track = list.find((t) => t.id === id);
    if (!track) throw new AppError("PROJECT_NOT_FOUND", "That track isn't in the library.");
    await storeUploadedMusic(list.filter((t) => t.id !== id), s.user.id);
    await deleteStoredFile(track.storageKey).catch(() => {});
    await recordAudit(s, { action: "settings.changed", resourceType: "music", resourceId: id, resourceLabel: `Studio music removed: ${track.title}` });
    revalidatePath("/brand");
    return { removed: true };
  });
}

import "server-only";
import { db } from "@/lib/database/client";
import { normaliseLimits, type UploadLimits } from "@/lib/validation/upload-limits";

const UPLOAD_LIMITS_KEY = "upload.limits";

/**
 * The highest limit anyone can set on the web, in MB. IT sets it per environment (what the server,
 * storage and network in front of it are sized for); the Administration page can't go above it.
 */
export const uploadCeilingMb = () => {
  const v = Number(process.env.UPLOAD_CEILING_MB);
  return Number.isFinite(v) && v >= 1 ? Math.floor(v) : 2048;
};

/** Current upload limits (MB per type): the stored values over the defaults, capped at the ceiling. */
export async function getUploadLimits(): Promise<UploadLimits> {
  const row = await db.appSetting.findUnique({ where: { key: UPLOAD_LIMITS_KEY } });
  let stored: Record<string, unknown> | null = null;
  try { stored = row ? (JSON.parse(row.value) as Record<string, unknown>) : null; } catch { stored = null; }
  return normaliseLimits(stored, uploadCeilingMb());
}

export async function uploadLimitsChange(): Promise<{ at: Date; by: string | null } | null> {
  const row = await db.appSetting.findUnique({ where: { key: UPLOAD_LIMITS_KEY } });
  if (!row) return null;
  const user = row.updatedById ? await db.user.findUnique({ where: { id: row.updatedById }, select: { displayName: true } }) : null;
  return { at: row.updatedAt, by: user?.displayName ?? null };
}

export async function storeUploadLimits(limits: UploadLimits, userId: string) {
  const value = JSON.stringify(limits);
  await db.appSetting.upsert({ where: { key: UPLOAD_LIMITS_KEY }, create: { key: UPLOAD_LIMITS_KEY, value, updatedById: userId }, update: { value, updatedById: userId } });
}

const PII_CODEX_KEY = "pii.codex";

/**
 * Whether Studio's personal-data detection may send the text it reads from the screen to Codex
 * (to find names, addresses and IDs that fixed rules miss). Off until a platform administrator
 * switches it on; the classification gate applies on top.
 */
export async function piiCodexEnabled(): Promise<boolean> {
  const row = await db.appSetting.findUnique({ where: { key: PII_CODEX_KEY } });
  try { return row ? JSON.parse(row.value) === true : false; } catch { return false; }
}

export async function storePiiCodex(enabled: boolean, userId: string) {
  const value = JSON.stringify(enabled);
  await db.appSetting.upsert({ where: { key: PII_CODEX_KEY }, create: { key: PII_CODEX_KEY, value, updatedById: userId }, update: { value, updatedById: userId } });
}

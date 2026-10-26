import "server-only";
import { db } from "@/lib/database/client";
import { normaliseLimits, type UploadLimits } from "@/lib/validation/upload-limits";
import { normaliseBrandTemplate, type BrandTemplate } from "@/lib/studio/brand-template";
import { BUILT_IN_MUSIC, uploadedTrackUrl, type MusicTrack, type StoredTrack } from "@/lib/studio/music";

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

const BRAND_KEY = "studio.brand";

/** Studio's brand template (Brand Center): the stored values over the defaults. */
export async function getBrandTemplate(): Promise<BrandTemplate> {
  const row = await db.appSetting.findUnique({ where: { key: BRAND_KEY } });
  try { return normaliseBrandTemplate(row ? JSON.parse(row.value) : null); } catch { return normaliseBrandTemplate(null); }
}

export async function storeBrandTemplate(t: BrandTemplate, userId: string) {
  const value = JSON.stringify(t);
  await db.appSetting.upsert({ where: { key: BRAND_KEY }, create: { key: BRAND_KEY, value, updatedById: userId }, update: { value, updatedById: userId } });
}

const MUSIC_KEY = "studio.music";

/** Music tracks a brand administrator uploaded (company-licensed); the built-in ones are in lib/studio/music.ts. */
export async function getUploadedMusic(): Promise<StoredTrack[]> {
  const row = await db.appSetting.findUnique({ where: { key: MUSIC_KEY } });
  try { const v = row ? (JSON.parse(row.value) as StoredTrack[]) : []; return Array.isArray(v) ? v : []; } catch { return []; }
}

export async function storeUploadedMusic(list: StoredTrack[], userId: string) {
  const value = JSON.stringify(list);
  await db.appSetting.upsert({ where: { key: MUSIC_KEY }, create: { key: MUSIC_KEY, value, updatedById: userId }, update: { value, updatedById: userId } });
}

/** Every track a Studio edit can choose: built in first, then uploaded. */
export async function musicLibrary(): Promise<MusicTrack[]> {
  const uploaded = await getUploadedMusic();
  return [...BUILT_IN_MUSIC, ...uploaded.map((t) => ({ id: t.id, title: t.title, note: t.licence, builtIn: false, url: uploadedTrackUrl(t.id) }))];
}

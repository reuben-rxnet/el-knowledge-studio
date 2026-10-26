// Upload size limits per file type. Shared by the browser (checks before upload) and the server
// (enforced while the file streams in). The values live in the database and are edited by platform
// administrators on the Administration page, up to a ceiling IT sets (UPLOAD_CEILING_MB).

export const UPLOAD_CATEGORIES = ["video", "audio", "presentation", "pdf", "document", "image", "text"] as const;
export type UploadCategory = (typeof UPLOAD_CATEGORIES)[number];
/** Megabytes per category. */
export type UploadLimits = Record<UploadCategory, number>;

export const CATEGORY_META: Record<UploadCategory, { label: string; types: string; extensions: string[] }> = {
  video: { label: "Video", types: "MP4, MOV, WEBM", extensions: ["mp4", "mov", "webm"] },
  audio: { label: "Audio", types: "MP3, WAV", extensions: ["mp3", "wav"] },
  presentation: { label: "PowerPoint", types: "PPTX", extensions: ["pptx"] },
  pdf: { label: "PDF", types: "PDF", extensions: ["pdf"] },
  document: { label: "Word", types: "DOCX", extensions: ["docx"] },
  image: { label: "Images", types: "PNG, JPG", extensions: ["png", "jpg", "jpeg"] },
  text: { label: "Text", types: "TXT", extensions: ["txt"] },
};

/** Defaults until an administrator changes them. Video ~30-60 min of screen recording; WAV is uncompressed. */
export const DEFAULT_UPLOAD_LIMITS: UploadLimits = { video: 1024, audio: 500, presentation: 300, pdf: 200, document: 100, image: 25, text: 10 };

export const MB = 1024 * 1024;

export const categoryOf = (fileName: string): UploadCategory | null => {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return UPLOAD_CATEGORIES.find((c) => CATEGORY_META[c].extensions.includes(ext)) ?? null;
};

/** "1 GB", "500 MB": how a limit is shown to people. */
export const formatLimit = (mb: number) => (mb >= 1024 && mb % 1024 === 0 ? `${mb / 1024} GB` : mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`);

/** Merges stored values over the defaults and keeps each one between 1 MB and the ceiling. */
export function normaliseLimits(stored: Partial<Record<string, unknown>> | null | undefined, ceilingMb: number): UploadLimits {
  const out = { ...DEFAULT_UPLOAD_LIMITS };
  for (const c of UPLOAD_CATEGORIES) {
    const v = Number(stored?.[c]);
    if (Number.isFinite(v) && v >= 1) out[c] = Math.floor(v);
    out[c] = Math.min(out[c], ceilingMb);
  }
  return out;
}

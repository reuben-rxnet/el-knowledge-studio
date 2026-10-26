// Reading the JSON a finished render stores about itself (RenderJob.chapters, RenderJob.captionTracks).
// Anything unreadable counts as "none", so a damaged field never breaks a page or an export.

export interface RenderChapter { start: number; end: number; title: string }
export interface CaptionTrack { language: string; key: string }

export function parseChapters(raw: string | null | undefined): RenderChapter[] {
  try {
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? v.filter((c): c is RenderChapter => !!c && typeof c.start === "number" && typeof c.end === "number" && typeof c.title === "string") : [];
  } catch {
    return [];
  }
}

export function parseCaptionTracks(raw: string | null | undefined): CaptionTrack[] {
  try {
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? v.filter((t): t is CaptionTrack => !!t && typeof t.language === "string" && typeof t.key === "string") : [];
  } catch {
    return [];
  }
}

// A copy of a version's content, taken when it gets final approval (ProjectVersion.snapshot). Steps,
// FAQs and the script live in one set of tables per project, so once version N+1 is being edited the
// tables no longer show version N; the snapshot is what lets the approved version still be published.

export interface SnapshotStep {
  id: string; order: number; chapter: string; title: string; instruction: string;
  expectedResult: string | null; warning: string | null; tip: string | null; sourceRef: string | null;
}

export interface VersionSnapshot {
  format: 1;
  version: number;
  takenAt: string;
  title: string;
  description: string;
  primaryLanguage: string;
  steps: SnapshotStep[];
  faqs: { question: string; answer: string }[];
  script: { id: string; order: number; startSec: number; endSec: number; text: string }[];
  /** Machine or reviewed translations of step titles, instructions and script paragraphs. */
  translations: { language: string; sourceType: string; sourceId: string; text: string; status: string }[];
  /** Languages whose translation was approved (or published) when the version was approved. */
  approvedLanguages: string[];
}

/** Reads a stored snapshot; null when there is none or it can't be read (treated as "no snapshot"). */
export function parseSnapshot(raw: string | null | undefined): VersionSnapshot | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<VersionSnapshot>;
    if (v?.format !== 1 || !Array.isArray(v.steps) || !Array.isArray(v.faqs) || !Array.isArray(v.translations)) return null;
    return { script: [], approvedLanguages: [], ...v } as VersionSnapshot;
  } catch {
    return null;
  }
}

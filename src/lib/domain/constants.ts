// Domain vocabularies. Stored as strings in the database; validated here.

export const PROJECT_STATUSES = [
  "draft",
  "processing",
  "ai-generated",
  "creator-review",
  "sme-review",
  "compliance-review",
  "translation-review",
  "approval-pending",
  "approved",
  "published",
  "changes-requested",
  "expired",
  "archived",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export type Tone = "ok" | "warn" | "err" | "info" | "ai" | "neutral";

export const STATUS_META: Record<ProjectStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  processing: { label: "Processing", tone: "info" },
  "ai-generated": { label: "AI generated", tone: "ai" },
  "creator-review": { label: "Creator review", tone: "info" },
  "sme-review": { label: "SME review", tone: "warn" },
  "compliance-review": { label: "Compliance review", tone: "warn" },
  "translation-review": { label: "Translation review", tone: "warn" },
  "approval-pending": { label: "Approval pending", tone: "warn" },
  approved: { label: "Approved", tone: "ok" },
  published: { label: "Published", tone: "ok" },
  "changes-requested": { label: "Changes requested", tone: "err" },
  expired: { label: "Expired", tone: "err" },
  archived: { label: "Archived", tone: "neutral" },
};

export const CLASSIFICATIONS = ["Public", "Internal", "Confidential", "Highly Confidential", "Restricted"] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

/** Classification policy: what each label allows. Configurable per enterprise (mocked here). */
export const CLASSIFICATION_POLICY: Record<
  Classification,
  { recording: boolean; download: boolean; externalShare: boolean; translation: boolean; destinations: string[] }
> = {
  Public: { recording: true, download: true, externalShare: true, translation: true, destinations: ["sharepoint", "stream", "teams", "leonardo", "knowzy", "portal", "package"] },
  Internal: { recording: true, download: true, externalShare: false, translation: true, destinations: ["sharepoint", "stream", "teams", "leonardo", "knowzy", "portal", "package"] },
  Confidential: { recording: true, download: false, externalShare: false, translation: true, destinations: ["sharepoint", "stream", "teams", "knowzy"] },
  "Highly Confidential": { recording: true, download: false, externalShare: false, translation: false, destinations: ["sharepoint"] },
  Restricted: { recording: false, download: false, externalShare: false, translation: false, destinations: [] },
};

export const BUSINESS_FUNCTIONS = [
  "Retail Operations",
  "Finance",
  "Human Resources",
  "Manufacturing",
  "Sales & Marketing",
  "Supply Chain",
  "IT & Digital",
  "Customer Service",
  "Quality",
  "Compliance",
  "Learning & Development",
  "R&D",
] as const;

export const REGIONS = ["Global", "Europe", "North America", "Latin America", "Asia Pacific", "Middle East & Africa"] as const;

export const LANGUAGES: { code: string; label: string; native: string; rtl?: boolean }[] = [
  { code: "en", label: "English", native: "English" },
  { code: "fr", label: "French", native: "Français" },
  { code: "it", label: "Italian", native: "Italiano" },
  { code: "es", label: "Spanish", native: "Español" },
  { code: "de", label: "German", native: "Deutsch" },
  { code: "pt", label: "Portuguese", native: "Português" },
  { code: "zh", label: "Simplified Chinese", native: "简体中文" },
  { code: "ja", label: "Japanese", native: "日本語" },
  { code: "hi", label: "Hindi", native: "हिन्दी" },
  { code: "ar", label: "Arabic", native: "العربية", rtl: true },
];

export const languageLabel = (code: string) => LANGUAGES.find((l) => l.code === code)?.label ?? code;

export const SOURCE_KINDS = [
  { key: "recording", label: "Screen recording", hint: "Capture a browser tab, window or screen" },
  { key: "video", label: "Video upload", hint: "MP4, MOV or WEBM" },
  { key: "audio", label: "Audio upload", hint: "MP3 or WAV narration" },
  { key: "document", label: "Document", hint: "DOCX or PDF procedure" },
  { key: "presentation", label: "Presentation", hint: "PPTX training deck" },
  { key: "images", label: "Images", hint: "PNG or JPG screenshots" },
  { key: "meeting", label: "Approved meeting recording", hint: "Teams recording with participant consent" },
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number]["key"];

export const OUTPUT_TYPES = [
  { key: "video", label: "Polished video", hint: "Chapters, zooms, captions" },
  { key: "guide", label: "Step-by-step guide", hint: "Annotated screenshots" },
  { key: "sop", label: "SOP", hint: "Controlled procedure format" },
  { key: "article", label: "Knowledge article", hint: "Searchable summary" },
  { key: "qrg", label: "Quick-reference guide", hint: "One-page checklist" },
  { key: "faq", label: "FAQ", hint: "Grounded in the source" },
  { key: "training", label: "Training summary", hint: "Learning objectives" },
  { key: "quiz", label: "Quiz", hint: "Reviewed before publishing" },
  { key: "subtitles", label: "Subtitles", hint: "WebVTT per language" },
  { key: "localization", label: "Localization package", hint: "Target languages" },
] as const;

export const TEMPLATES = [
  { key: "global", name: "Global corporate", fn: "Global" },
  { key: "manufacturing", name: "Manufacturing procedure", fn: "Manufacturing" },
  { key: "retail", name: "Retail operations", fn: "Retail Operations" },
  { key: "learning", name: "Learning module", fn: "Learning & Development" },
  { key: "hr", name: "HR process", fn: "Human Resources" },
  { key: "finance", name: "Finance procedure", fn: "Finance" },
  { key: "it", name: "IT application guide", fn: "IT & Digital" },
  { key: "compliance", name: "Compliance procedure", fn: "Compliance" },
  { key: "product", name: "Product demonstration", fn: "Sales & Marketing" },
  { key: "change", name: "Change communication", fn: "Global" },
] as const;

export const DESTINATIONS = [
  { key: "sharepoint", label: "SharePoint", target: "EL Knowledge / Process Library" },
  { key: "stream", label: "Microsoft Stream", target: "Knowledge Studio channel" },
  { key: "teams", label: "Microsoft Teams", target: "Operations Excellence · General" },
  { key: "leonardo", label: "Leonardo", target: "Learning catalogue" },
  { key: "knowzy", label: "Knowzy", target: "Knowledge base" },
  { key: "portal", label: "Internal knowledge portal", target: "Knowledge Hub" },
  { key: "package", label: "Download package", target: "ZIP (video, guide, captions)" },
] as const;
export const destinationLabel = (key: string) => DESTINATIONS.find((d) => d.key === key)?.label ?? key;

export type FreshnessStatus = "current" | "due-soon" | "overdue" | "expired" | "archived";
export const FRESHNESS_META: Record<FreshnessStatus, { label: string; tone: Tone }> = {
  current: { label: "Current", tone: "ok" },
  "due-soon": { label: "Review due soon", tone: "warn" },
  overdue: { label: "Review overdue", tone: "err" },
  expired: { label: "Expired", tone: "err" },
  archived: { label: "Archived", tone: "neutral" },
};

export function freshnessOf(nextReviewAt: Date | null, status: string, now = new Date()): FreshnessStatus {
  if (status === "archived") return "archived";
  if (status === "expired") return "expired";
  if (!nextReviewAt) return "current";
  const days = (nextReviewAt.getTime() - now.getTime()) / 86_400_000;
  if (days < -60) return "expired";
  if (days < 0) return "overdue";
  if (days < 30) return "due-soon";
  return "current";
}

export const csv = (s: string | null | undefined) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : []);

/** Sources with a timeline. Everything else (documents, slides, images, notes) is cited by page or section. */
export const MEDIA_SOURCE_KINDS = ["recording", "video", "audio", "meeting"] as const;
export const isMediaSource = (kind: string | null | undefined) => !!kind && (MEDIA_SOURCE_KINDS as readonly string[]).includes(kind);

export const FLAG_META: Record<string, { label: string; tone: Tone }> = {
  risky: { label: "Risky instruction", tone: "err" },
  ambiguous: { label: "Ambiguous", tone: "warn" },
  typo: { label: "Typo", tone: "neutral" },
  "missing-info": { label: "Missing information", tone: "warn" },
  contradiction: { label: "Contradiction", tone: "err" },
};

export const FEEDBACK_CATEGORIES = ["problem", "idea", "question", "praise"] as const;
export const FEEDBACK_META: Record<(typeof FEEDBACK_CATEGORIES)[number], { label: string; hint: string }> = {
  problem: { label: "Something's wrong", hint: "An error, wrong result or something confusing" },
  idea: { label: "Idea", hint: "Something that would make your work easier" },
  question: { label: "Question", hint: "You're not sure how something works" },
  praise: { label: "Works well", hint: "Something worth keeping" },
};

// ContentGenerationJob — stage plan and deterministic progress.
// In the prototype, progress is derived from elapsed time since the job started, so any number of
// pollers observe the same state (idempotent, no worker process needed). In production each stage
// is an Azure Durable Functions activity publishing progress events via Service Bus.

export type JobStatus = "queued" | "running" | "waiting" | "succeeded" | "partial" | "failed" | "cancelled";
export type StageStatus = "queued" | "running" | "succeeded" | "failed" | "skipped";
export type StageState = Record<string, { status: StageStatus; detail?: string }>;

export interface StageDef {
  key: string;
  phase: string;
  title: string;
  explanation: string;
  weight: number;
}

/** 15 technical stages grouped into 7 user-facing phases. */
export const STAGES: StageDef[] = [
  { key: "ingest", phase: "Capture", title: "Uploading source", explanation: "Receiving your file over an encrypted connection.", weight: 1 },
  { key: "scan", phase: "Capture", title: "Securing source file", explanation: "Scanning for malware and storing it in your workspace's data region.", weight: 1 },
  { key: "extract", phase: "Understanding", title: "Extracting audio and frames", explanation: "Separating narration from the picture and sampling key frames.", weight: 1 },
  { key: "detect-scenes", phase: "Understanding", title: "Detecting actions and scene changes", explanation: "Finding clicks, screen changes and pauses that mark steps.", weight: 1 },
  { key: "transcribe", phase: "Transcription", title: "Transcribing narration", explanation: "Turning speech into a timestamped transcript.", weight: 2 },
  { key: "detect-sensitive", phase: "Knowledge Extraction", title: "Identifying sensitive information", explanation: "Flagging e-mail addresses, faces and customer data for redaction.", weight: 1 },
  { key: "chapters", phase: "Knowledge Extraction", title: "Creating chapters", explanation: "Grouping scenes into chapters people can jump to.", weight: 1 },
  { key: "create-script", phase: "Content Creation", title: "Improving the script", explanation: "Removing filler words while keeping product and system names.", weight: 1 },
  { key: "screenshots", phase: "Content Creation", title: "Generating screenshots", explanation: "Capturing the clearest frame for each step.", weight: 1 },
  { key: "create-guide", phase: "Content Creation", title: "Generating guide steps", explanation: "Writing instructions grounded in what you said and did.", weight: 2 },
  { key: "subtitles", phase: "Content Creation", title: "Creating subtitles", explanation: "Timing captions to the narration.", weight: 1 },
  { key: "voiceover", phase: "Content Creation", title: "Preparing voiceover", explanation: "Preparing an approved synthetic voice for the polished script.", weight: 1 },
  { key: "preview", phase: "Content Creation", title: "Rendering preview", explanation: "Composing zooms, highlights and branding into a preview.", weight: 1 },
  { key: "quiz", phase: "Content Creation", title: "Drafting quiz questions", explanation: "Writing assessment questions from the approved steps, for review.", weight: 1 },
  { key: "translations", phase: "Localization", title: "Preparing translations", explanation: "Machine-translating with your terminology glossary locked.", weight: 1 },
  { key: "quality-check", phase: "Quality Review", title: "Running quality checks", explanation: "Validating structure, terminology and source grounding.", weight: 1 },
];

export const PHASES = ["Capture", "Understanding", "Transcription", "Knowledge Extraction", "Content Creation", "Localization", "Quality Review"] as const;

const TOTAL_WEIGHT = STAGES.reduce((n, s) => n + s.weight, 0);

export interface JobSnapshot {
  status: JobStatus;
  percent: number;
  stages: (StageDef & { status: StageStatus; percent: number; detail?: string })[];
  currentStage: string | null;
}

export function parseStageState(raw: string | null | undefined): StageState {
  try { const v = JSON.parse(raw ?? "{}"); return v && typeof v === "object" ? (v as StageState) : {}; } catch { return {}; }
}

/** Live jobs: the runner records real progress per stage; the snapshot just reads it. */
export function snapshotLiveJob(job: { status: string; stageState: string }): JobSnapshot {
  const state = parseStageState(job.stageState);
  let doneWeight = 0;
  let current: string | null = null;
  const stages = STAGES.map((s) => {
    const st = state[s.key]?.status ?? "queued";
    if (st === "succeeded" || st === "skipped" || st === "failed") doneWeight += s.weight;
    if (st === "running" && !current) current = s.key;
    return { ...s, status: st, percent: st === "running" ? 50 : st === "queued" ? 0 : 100, detail: state[s.key]?.detail };
  });
  const terminal = ["succeeded", "partial", "failed", "cancelled"].includes(job.status);
  return { status: job.status as JobStatus, percent: terminal ? 100 : Math.min(99, Math.round((doneWeight / TOTAL_WEIGHT) * 100)), stages, currentStage: current };
}

export function snapshotAny(job: { status: string; startedAt: Date; simulatedMs: number; mode: string; stageState: string }, now = new Date()): JobSnapshot {
  return job.mode === "live" ? snapshotLiveJob(job) : snapshotJob(job, now);
}

export function snapshotJob(job: { status: string; startedAt: Date; simulatedMs: number }, now = new Date()): JobSnapshot {
  const terminal = job.status === "cancelled" || job.status === "failed";
  const elapsed = Math.max(0, now.getTime() - job.startedAt.getTime());
  const fraction = job.status === "succeeded" ? 1 : Math.min(1, elapsed / job.simulatedMs);
  const progressWeight = fraction * TOTAL_WEIGHT;

  let acc = 0;
  let current: string | null = null;
  const stages = STAGES.map((s) => {
    const start = acc;
    acc += s.weight;
    let status: StageStatus;
    let percent: number;
    if (progressWeight >= acc) { status = "succeeded"; percent = 100; }
    else if (progressWeight > start) { status = terminal ? "failed" : "running"; percent = Math.round(((progressWeight - start) / s.weight) * 100); current = s.key; }
    else { status = "queued"; percent = 0; }
    return { ...s, status, percent };
  });

  const percent = Math.round(fraction * 100);
  const status: JobStatus = terminal ? (job.status as JobStatus) : fraction >= 1 ? "succeeded" : elapsed > 0 ? "running" : "queued";
  return { status, percent, stages, currentStage: current };
}

export function phaseStatus(snapshot: JobSnapshot, phase: string): StageStatus {
  const ss = snapshot.stages.filter((s) => s.phase === phase);
  if (ss.every((s) => s.status === "succeeded")) return "succeeded";
  if (ss.some((s) => s.status === "failed")) return "failed";
  if (ss.some((s) => s.status === "running" || s.status === "succeeded")) return "running";
  return "queued";
}

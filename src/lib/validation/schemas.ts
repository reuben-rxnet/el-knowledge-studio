import { z } from "zod";
import { BUSINESS_FUNCTIONS, CLASSIFICATIONS, DESTINATIONS, LANGUAGES, OUTPUT_TYPES, REGIONS, SOURCE_KINDS, TEMPLATES } from "@/lib/domain/constants";

const keys = <T extends readonly { key: string }[]>(xs: T) => xs.map((x) => x.key) as [T[number]["key"], ...T[number]["key"][]];
const langCodes = LANGUAGES.map((l) => l.code) as [string, ...string[]];
const text = (max: number) => z.string().trim().max(max);

export const createProjectSchema = z
  .object({
    sourceKind: z.enum(keys(SOURCE_KINDS)),
    outputs: z.array(z.enum(keys(OUTPUT_TYPES))).min(1, "Choose at least one output."),
    title: text(140).min(3, "Add a title of at least 3 characters."),
    description: text(4000).default(""),
    businessFunction: z.enum(BUSINESS_FUNCTIONS),
    processCategory: text(80).min(1, "Add a process category."),
    region: z.enum(REGIONS),
    country: text(60).min(1, "Add a country."),
    sourceSystem: text(80).default(""),
    audience: text(120).min(1, "Describe the intended audience."),
    classification: z.enum(CLASSIFICATIONS),
    smeName: text(80).default(""),
    approverName: text(80).default(""),
    primaryLanguage: z.enum(langCodes),
    targetLanguages: z.array(z.enum(langCodes)).default([]),
    destinations: z.array(z.enum(keys(DESTINATIONS))).default([]),
    reviewFrequencyDays: z.coerce.number().int().refine((n) => [90, 180, 365].includes(n), "Choose a review frequency."),
    templateKey: z.enum(keys(TEMPLATES)),
    upload: z
      .object({ fileName: text(200).min(1), mimeType: text(120), sizeBytes: z.number().int().nonnegative(), checksum: text(128).min(8), durationSec: z.number().int().nonnegative().optional(), storageKey: text(200).optional() })
      .optional(),
  })
  .refine((v) => v.classification !== "Restricted", { path: ["classification"], message: "Restricted content can't be recorded or processed by AI." })
  .refine((v) => !v.targetLanguages.includes(v.primaryLanguage), { path: ["targetLanguages"], message: "Target languages can't include the primary language." });
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const commentSchema = z.object({
  projectId: z.string().cuid(),
  body: text(2000).min(1, "Write a comment first."),
  anchorType: z.enum(["project", "step", "scene"]),
  anchorRef: z.string().cuid().optional(),
});

export const decisionSchema = z
  .object({
    reviewId: z.string().cuid(),
    expectedVersion: z.number().int().positive(),
    decision: z.enum(["approve", "request-changes"]),
    justification: text(1000).default(""),
  })
  .refine((v) => v.decision === "approve" || v.justification.length >= 5, {
    path: ["justification"],
    message: "Explain what needs to change so the creator can act on it.",
  });

export const publishSchema = z.object({
  projectId: z.string().cuid(),
  version: z.number().int().positive(),
  destinations: z.array(z.enum(keys(DESTINATIONS))).min(1, "Choose at least one destination."),
  language: z.enum(langCodes),
  audience: text(120).min(1),
  requireAck: z.boolean().default(false),
  watermark: z.boolean().default(true),
});

export const scriptEditSchema = z.object({ segmentId: z.string().cuid(), text: text(4000).min(1, "A script paragraph can't be empty.") });
export const stepEditSchema = z.object({
  stepId: z.string().cuid(),
  title: text(160).min(1, "A step needs a title."),
  instruction: text(4000).min(1, "A step needs an instruction."),
  warning: text(1000).optional(),
  tip: text(1000).optional(),
});

/** Upload validation shared by client and server. */
export const UPLOAD_RULES = {
  maxBytes: Number(process.env.MAX_UPLOAD_MB ?? 2048) * 1024 * 1024,
  types: {
    mp4: ["video/mp4"], mov: ["video/quicktime"], webm: ["video/webm"], mp3: ["audio/mpeg"], wav: ["audio/wav", "audio/x-wav"],
    pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    pdf: ["application/pdf"], txt: ["text/plain"], png: ["image/png"], jpg: ["image/jpeg"], jpeg: ["image/jpeg"],
  } as Record<string, string[]>,
};

export type UploadCheck = { ok: true; kind: "video" | "audio" | "document" | "presentation" | "images" } | { ok: false; code: string; message: string };

export function validateUpload(file: { name: string; type: string; size: number }, maxBytes = UPLOAD_RULES.maxBytes): UploadCheck {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const allowed = UPLOAD_RULES.types[ext];
  if (!allowed) return { ok: false, code: "UNSUPPORTED_TYPE", message: `.${ext || "?"} files aren't supported. Use MP4, MOV, WEBM, MP3, WAV, PPTX, DOCX, PDF, PNG or JPG.` };
  if (file.type && !allowed.includes(file.type)) return { ok: false, code: "TYPE_MISMATCH", message: `The file says it's .${ext} but its content type is ${file.type}. Export it again and retry.` };
  if (file.size === 0) return { ok: false, code: "EMPTY_FILE", message: "This file is empty or damaged. Export it again from the original application." };
  if (file.size > maxBytes) return { ok: false, code: "TOO_LARGE", message: `This file is larger than ${Math.round(maxBytes / 1048576)} MB. Trim it or split it into parts.` };
  const kind = ["mp4", "mov", "webm"].includes(ext) ? "video" : ["mp3", "wav"].includes(ext) ? "audio" : ext === "pptx" ? "presentation" : ["png", "jpg", "jpeg"].includes(ext) ? "images" : "document";
  return { ok: true, kind };
}

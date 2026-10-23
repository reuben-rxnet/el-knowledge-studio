import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { snapshotLiveJob, STAGES } from "@/lib/services/processing-plan";
import { extractDocumentText } from "@/lib/services/extract";
import { quizSchema } from "@/lib/services/interfaces";
import { mockQuiz, mockTranslator } from "@/lib/services/mock";
import { openAIQuizService, openAITranslator } from "@/lib/services/openai/services";
import { openAITranscriber } from "@/lib/services/openai/audio";
import type { OpenAIConfig } from "@/lib/services/openai/config";

const CFG: OpenAIConfig = {
  baseUrl: "https://dev-apim-ai.luxottica.com/codex/openai/v1", modelId: "gpt-5.3-codex_codeassist", apiStyle: "RESPONSES",
  auth: { location: "QUERY_PARAMETER", parameterName: "subscription-key" }, extraHeaders: { "x-openai-supplier": "EssilorLuxottica" },
  allowedHosts: ["api.openai.com", "dev-apim-ai.luxottica.com"], timeoutMs: 5000, maxOutputTokens: null, approvalRef: "PRIV-1",
};
const answer = (obj: unknown) => new Response(JSON.stringify({ model: "m", output: [{ content: [{ type: "output_text", text: JSON.stringify(obj) }] }] }), { status: 200 });

describe("live job snapshot", () => {
  it("reads real stage progress, counting skipped stages as done", () => {
    const state = { ingest: { status: "succeeded" }, scan: { status: "succeeded" }, extract: { status: "skipped", detail: "No file" }, transcribe: { status: "running" } };
    const snap = snapshotLiveJob({ status: "running", stageState: JSON.stringify(state) });
    expect(snap.currentStage).toBe("transcribe");
    expect(snap.stages.find((s) => s.key === "extract")).toMatchObject({ status: "skipped", detail: "No file" });
    expect(snap.percent).toBeGreaterThan(0);
    expect(snap.percent).toBeLessThan(100);
  });
  it("reports 100% only when the job is terminal", () => {
    const all = Object.fromEntries(STAGES.map((s) => [s.key, { status: "succeeded" }]));
    expect(snapshotLiveJob({ status: "running", stageState: JSON.stringify(all) }).percent).toBe(99);
    expect(snapshotLiveJob({ status: "partial", stageState: "{}" }).percent).toBe(100);
  });
  it("tolerates corrupt state", () => expect(snapshotLiveJob({ status: "queued", stageState: "not json" }).stages.every((s) => s.status === "queued")).toBe(true));
});

describe("document text extraction", () => {
  it("reads DOCX paragraphs", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", `<w:document><w:body><w:p><w:r><w:t>Open Store Portal</w:t></w:r></w:p><w:p><w:r><w:t>Select Close Day &amp; count cash</w:t></w:r></w:p></w:body></w:document>`);
    const text = await extractDocumentText(Buffer.from(await zip.generateAsync({ type: "uint8array" })), "close.docx");
    expect(text).toBe("Open Store Portal\nSelect Close Day & count cash");
  });
  it("reads PPTX slides in order", async () => {
    const zip = new JSZip();
    zip.file("ppt/slides/slide2.xml", `<p:sld><a:p><a:r><a:t>Second</a:t></a:r></a:p></p:sld>`);
    zip.file("ppt/slides/slide1.xml", `<p:sld><a:p><a:r><a:t>First</a:t></a:r></a:p></p:sld>`);
    const text = await extractDocumentText(Buffer.from(await zip.generateAsync({ type: "uint8array" })), "deck.pptx");
    expect(text).toBe("Slide 1\nFirst\n\nSlide 2\nSecond");
  });
  it("reads plain text and ignores media", async () => {
    expect(await extractDocumentText(Buffer.from("Step 1\r\nStep 2"), "notes.txt")).toBe("Step 1\nStep 2");
    expect(await extractDocumentText(Buffer.from("x"), "clip.mp4")).toBeNull();
  });
});

describe("Codex quiz and translation", () => {
  it("mock quiz output is schema-valid", async () => {
    const q = await mockQuiz.generate({ title: "T", language: "en", steps: [{ order: 0, title: "Open", instruction: "Open it." }] });
    expect(quizSchema.safeParse(q).success).toBe(true);
  });
  it("mock translation is visibly marked as simulated", async () => {
    expect(await mockTranslator.translate({ texts: ["Hello"], from: "en", to: "fr", protectedTerms: [] })).toEqual(["[FR · simulated] Hello"]);
  });
  it("Codex quiz rejects an out-of-range correct answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(answer({ questions: [{ kind: "single", question: "Q", options: ["a", "b"], correct: [5], explanation: "e", difficulty: "easy", objective: "o", sourceStepOrder: 0 }] }));
    await expect(openAIQuizService({ config: CFG, revealKey: () => "k", fetch: fetchMock as unknown as typeof fetch }).generate({ title: "T", language: "en", steps: [{ order: 0, title: "s", instruction: "i" }] })).rejects.toMatchObject({ code: "MALFORMED_OUTPUT" });
  });
  it("Codex translation must return one string per segment and keeps protected terms", async () => {
    const wrongCount = vi.fn().mockResolvedValue(answer({ translations: ["un"] }));
    await expect(openAITranslator({ config: CFG, revealKey: () => "k", fetch: wrongCount as unknown as typeof fetch }).translate({ texts: ["one", "two"], from: "en", to: "fr", protectedTerms: [] })).rejects.toMatchObject({ code: "MALFORMED_OUTPUT" });
    const dropped = vi.fn().mockResolvedValue(answer({ translations: ["Ouvrez le portail", "Bonjour"] }));
    const out = await openAITranslator({ config: CFG, revealKey: () => "k", fetch: dropped as unknown as typeof fetch }).translate({ texts: ["Open Store Portal", "Hello"], from: "en", to: "fr", protectedTerms: ["Store Portal"] });
    expect(out).toEqual(["Open Store Portal", "Bonjour"]);
  });
});

describe("Codex transcription", () => {
  it("is unavailable unless a transcription model is configured", () => {
    expect(openAITranscriber({ config: CFG, model: null }).available).toBe(false);
    expect(openAITranscriber({ config: CFG, model: "whisper-1" }).available).toBe(true);
  });
  it("posts multipart to /audio/transcriptions with the gateway key and reads segments", async () => {
    const fetchMock = vi.fn<(url: URL | RequestInfo, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ text: "Open the day.", segments: [{ start: 0.2, end: 3.7, text: " Open the day." }] }), { status: 200 }));
    const t = await openAITranscriber({ config: CFG, model: "whisper-1", revealKey: () => "k123", fetch: fetchMock as unknown as typeof fetch }).transcribe({ file: new Blob(["x"], { type: "video/webm" }), fileName: "r.webm" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(new URL(String(url)).pathname).toBe("/codex/openai/v1/audio/transcriptions");
    expect(new URL(String(url)).searchParams.get("subscription-key")).toBe("k123");
    expect(init!.body).toBeInstanceOf(FormData);
    expect(t).toEqual({ text: "Open the day.", segments: [{ startSec: 0, endSec: 4, text: "Open the day." }] });
  });
  it("explains a missing audio route on the gateway", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 404 }));
    await expect(openAITranscriber({ config: CFG, model: "whisper-1", revealKey: () => "k", fetch: fetchMock as unknown as typeof fetch }).transcribe({ file: new Blob(["x"]), fileName: "r.webm" })).rejects.toMatchObject({ code: "TRANSCRIPTION_ROUTE_MISSING" });
  });
});

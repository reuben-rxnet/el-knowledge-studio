import "server-only";
import path from "node:path";
import type { AudioTranscriptionService } from "../interfaces";
import { decodeAudio16k } from "./ffmpeg";

/**
 * Open-source speech models that run ON THIS SERVER — no audio or text leaves the machine.
 *   Speech-to-text: OpenAI Whisper (open weights) via Hugging Face transformers.js (Apache-2.0)
 *   Text-to-speech: Kokoro-82M (Apache-2.0) via kokoro-js — English voices only
 * Models download once from Hugging Face into MODELS_DIR (default ./models) and are cached.
 */
export const MODELS_DIR = path.resolve(/* turbopackIgnore: true */ process.env.MODELS_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), "models"));
export const LOCAL_STT_MODEL = process.env.LOCAL_STT_MODEL?.trim() || "onnx-community/whisper-base";
export const LOCAL_TTS_MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";

/** English voices offered for AI voiceover (Kokoro voice ids). */
export const TTS_VOICES = [
  { id: "bf_emma", label: "Emma · British English, female" },
  { id: "bm_george", label: "George · British English, male" },
  { id: "af_heart", label: "Heart · American English, female" },
  { id: "am_michael", label: "Michael · American English, male" },
] as const;
export type TtsVoice = (typeof TTS_VOICES)[number]["id"];
export const TTS_LANGUAGES = ["en"];

type Asr = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text: string; chunks?: { timestamp: [number, number | null]; text: string }[] }>;
let asrPromise: Promise<Asr> | null = null;
async function asr(): Promise<Asr> {
  asrPromise ??= (async () => {
    const { env, pipeline } = await import("@huggingface/transformers");
    env.cacheDir = MODELS_DIR;
    return (await pipeline("automatic-speech-recognition", LOCAL_STT_MODEL, { dtype: "q8" })) as unknown as Asr;
  })().catch((e) => { asrPromise = null; throw e; });
  return asrPromise;
}

interface Kokoro { generate(text: string, opts: { voice: string; speed?: number }): Promise<{ audio: Float32Array; sampling_rate: number; toWav(): ArrayBuffer }> }
let ttsPromise: Promise<Kokoro> | null = null;
async function tts(): Promise<Kokoro> {
  ttsPromise ??= (async () => {
    const { env } = await import("@huggingface/transformers");
    env.cacheDir = MODELS_DIR;
    const { KokoroTTS } = await import("kokoro-js");
    return (await KokoroTTS.from_pretrained(LOCAL_TTS_MODEL, { dtype: "q8", device: "cpu" })) as unknown as Kokoro;
  })().catch((e) => { ttsPromise = null; throw e; });
  return ttsPromise;
}

export const localSpeechEnabled = () => (process.env.SPEECH_PROVIDER ?? "local") === "local";

export const localTranscriber: AudioTranscriptionService & { transcribeFile(filePath: string, language?: string): ReturnType<AudioTranscriptionService["transcribe"]> } = {
  available: true,
  async transcribe() { throw new Error("Local transcription needs a file path; use transcribeFile."); },
  async transcribeFile(filePath, language) {
    const samples = await decodeAudio16k(filePath);
    if (samples.length < 16000 / 2) return { text: "", segments: [] }; // under half a second of audio
    const run = await asr();
    const r = await run(samples, { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5, ...(language ? { language, task: "transcribe" } : {}) });
    const segments = (r.chunks ?? []).filter((c) => c.text.trim()).map((c) => ({ startSec: Math.floor(c.timestamp[0] ?? 0), endSec: Math.ceil(c.timestamp[1] ?? (c.timestamp[0] ?? 0) + 2), text: c.text.trim() }));
    return { text: r.text.trim(), segments };
  },
};

/** One narration clip as a WAV file (24 kHz mono). English only. */
export async function synthesizeSpeech(text: string, voice: TtsVoice, speed = 1): Promise<{ wav: Buffer; seconds: number }> {
  const engine = await tts();
  const out = await engine.generate(text.slice(0, 2000), { voice, speed });
  return { wav: Buffer.from(out.toWav()), seconds: out.audio.length / out.sampling_rate };
}

/**
 * Word-level timings for Studio's text editing. Needs the "_timestamped" export of Whisper (same
 * weights, exported with the attention outputs word timing needs); the plain export can't do it.
 */
export const LOCAL_STT_WORDS_MODEL = process.env.LOCAL_STT_WORDS_MODEL?.trim() || "onnx-community/whisper-base_timestamped";
let wordsAsrPromise: Promise<Asr> | null = null;
async function wordsAsr(): Promise<Asr> {
  wordsAsrPromise ??= (async () => {
    const { env, pipeline } = await import("@huggingface/transformers");
    env.cacheDir = MODELS_DIR;
    return (await pipeline("automatic-speech-recognition", LOCAL_STT_WORDS_MODEL, { dtype: "q8" })) as unknown as Asr;
  })().catch((e) => { wordsAsrPromise = null; throw e; });
  return wordsAsrPromise;
}

export async function transcribeWords(filePath: string, language?: string): Promise<{ text: string; start: number; end: number }[]> {
  const samples = await decodeAudio16k(filePath);
  if (samples.length < 16000 / 2) return [];
  const run = await wordsAsr();
  const r = await run(samples, { return_timestamps: "word", chunk_length_s: 30, stride_length_s: 5, ...(language ? { language, task: "transcribe" } : {}) });
  return (r.chunks ?? [])
    .map((c) => ({ text: c.text.trim(), start: Math.round((c.timestamp[0] ?? 0) * 100) / 100, end: Math.round((c.timestamp[1] ?? (c.timestamp[0] ?? 0) + 0.3) * 100) / 100 }))
    .filter((w) => w.text && w.end > w.start);
}

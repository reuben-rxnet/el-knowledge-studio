import "server-only";
import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

/**
 * FFmpeg (open source) for audio extraction and video rendering. The bundled build comes from the
 * ffmpeg-static package (GPL). Production: an LGPL build or an IT-approved container image,
 * set with FFMPEG_PATH.
 */
export const FFMPEG = process.env.FFMPEG_PATH?.trim() || (ffmpegPath as unknown as string | null) || "ffmpeg";

/** Runs FFmpeg with an argument list (never a shell string). Rejects with the last stderr lines. */
export function runFfmpeg(args: string[], opts: { timeoutMs?: number; collectStdout?: boolean; cwd?: string } = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], { windowsHide: true, cwd: opts.cwd });
    const out: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (d: Buffer) => { if (opts.collectStdout) out.push(d); });
    child.stderr.on("data", (d: Buffer) => { err = (err + d.toString()).slice(-4000); });
    const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs ?? 15 * 60_000);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`FFmpeg failed (${code}): ${err.trim().split("\n").slice(-3).join(" ").slice(0, 300)}`));
    });
  });
}

/** Decodes any audio or video file to 16 kHz mono float samples (what Whisper expects). */
export async function decodeAudio16k(filePath: string): Promise<Float32Array> {
  const buf = await runFfmpeg(["-i", filePath, "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "pipe:1"], { collectStdout: true });
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}

/** Duration of a media file in seconds, read from FFmpeg's own probe output. */
export async function mediaDurationSec(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(FFMPEG, ["-hide_banner", "-i", filePath], { windowsHide: true });
    let err = "";
    child.stderr.on("data", (d: Buffer) => { err += d.toString(); });
    child.on("close", () => {
      const m = err.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
      resolve(m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0);
    });
    child.on("error", () => resolve(0));
  });
}

function ffmpegStderr(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(FFMPEG, ["-hide_banner", ...args], { windowsHide: true });
    let err = "";
    child.stderr.on("data", (d: Buffer) => { err = (err + d.toString()).slice(-200_000); });
    child.on("close", () => resolve(err));
    child.on("error", () => resolve(""));
  });
}
const hms = (m: RegExpMatchArray | null | undefined) => (m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0);

/**
 * Duration and which streams a media file has. Browser screen recordings (WEBM from MediaRecorder)
 * often have no duration in their header ("Duration: N/A"); then the file is read through without
 * decoding (stream copy to nowhere, milliseconds even for long files) and the last timestamp is used.
 */
export async function probeMedia(filePath: string): Promise<{ durationSec: number; hasVideo: boolean; hasAudio: boolean }> {
  const head = await ffmpegStderr(["-i", filePath]);
  const streams = { hasVideo: /Stream #\S+.*: Video:/.test(head), hasAudio: /Stream #\S+.*: Audio:/.test(head) };
  let durationSec = hms(head.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/));
  if (!durationSec && (streams.hasVideo || streams.hasAudio)) {
    const scan = await ffmpegStderr(["-i", filePath, "-map", "0", "-c", "copy", "-f", "null", "-"]);
    durationSec = hms([...scan.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)].at(-1));
  }
  return { durationSec, ...streams };
}

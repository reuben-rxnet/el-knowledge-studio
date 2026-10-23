"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Camera } from "lucide-react";
import { useToast } from "@/components/common/toast";

/**
 * Captures one frame per guide step from the project's own recording, in the browser (no FFmpeg),
 * and uploads it as the step's screenshot. Frames of scenes marked for redaction are blurred
 * before they leave the browser.
 */
export function CaptureScreenshots({ projectId, steps }: { projectId: string; steps: { id: string; sourceSec: number; redact: boolean }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function capture() {
    setError(null);
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.src = `/api/projects/${projectId}/media`;
    try {
      await new Promise<void>((res, rej) => { video.onloadeddata = () => res(); video.onerror = () => rej(new Error("The recording couldn't be loaded.")); });
      const width = Math.min(1280, video.videoWidth || 1280);
      const height = Math.round(width * ((video.videoHeight || 720) / (video.videoWidth || 1280)));
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      for (const [i, st] of steps.entries()) {
        setProgress(`Capturing ${i + 1} of ${steps.length}…`);
        // Half a second after the step starts, so the screen has usually changed.
        const t = Math.min(Math.max(0, st.sourceSec + 0.5), Math.max(0, (video.duration || st.sourceSec + 1) - 0.1));
        await new Promise<void>((res) => { video.onseeked = () => res(); video.currentTime = t; });
        ctx.filter = st.redact ? "blur(14px)" : "none";
        ctx.drawImage(video, 0, 0, width, height);
        const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
        if (!blob) throw new Error("A frame couldn't be encoded.");
        const form = new FormData();
        form.set("file", blob, `step-${i + 1}.png`);
        const r = await fetch(`/api/steps/${st.id}/screenshot`, { method: "POST", body: form });
        if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { message?: string } | null)?.message ?? `Upload failed (${r.status}).`);
      }
      toast(`${steps.length} screenshots captured from the recording. Check each one for personal or confidential data.`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Screenshots couldn't be captured.");
    } finally {
      setProgress(null);
      video.removeAttribute("src");
      video.load();
    }
  }

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <button className="btn sm" onClick={() => void capture()} disabled={progress !== null}><Camera size={14} aria-hidden /> {progress ?? "Capture screenshots from recording"}</button>
      {error && <span className="field-error" role="alert">{error}</span>}
    </div>
  );
}

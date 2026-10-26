// Client-side helpers shared by upload and recording. Server-side validation still applies.

/** Fingerprint without loading whole media into memory: SHA-256 of size + first 8 MB + last 1 MB. */
export async function fingerprint(file: Blob, name: string): Promise<string> {
  const head = await file.slice(0, 8 * 1024 * 1024).arrayBuffer();
  const tail = await file.slice(Math.max(0, file.size - 1024 * 1024)).arrayBuffer();
  const meta = new TextEncoder().encode(`${name}:${file.size}:`);
  const all = new Uint8Array(meta.byteLength + head.byteLength + tail.byteLength);
  all.set(meta, 0); all.set(new Uint8Array(head), meta.byteLength); all.set(new Uint8Array(tail), meta.byteLength + head.byteLength);
  const digest = await crypto.subtle.digest("SHA-256", all);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Reads duration from media metadata. Rejects when the browser can't decode it (likely corrupt). */
export function mediaDuration(file: Blob, kind: "video" | "audio"): Promise<number> {
  return new Promise((resolve, reject) => {
    const el = document.createElement(kind);
    const url = URL.createObjectURL(file);
    const done = () => URL.revokeObjectURL(url);
    el.preload = "metadata";
    el.onloadedmetadata = () => { const d = el.duration; done(); resolve(Number.isFinite(d) ? Math.round(d) : 0); };
    el.onerror = () => { done(); reject(new Error("decode")); };
    el.src = url;
  });
}

export interface StoredUpload { storageKey: string; fileName: string; mimeType: string; sizeBytes: number; checksum: string; durationSec?: number }

/**
 * Sends the file to the workspace's storage (POST /api/uploads) with progress. The file itself is the
 * request body (no form), so the server can stream it to storage at any size.
 */
export function uploadToStorage(file: Blob, fileName: string, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<StoredUpload> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads");
    xhr.setRequestHeader("x-file-name", encodeURIComponent(fileName));
    xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve(xhr.response as StoredUpload) : reject(new Error((xhr.response as { message?: string } | null)?.message ?? `Upload failed (${xhr.status}).`)));
    xhr.onerror = () => reject(new Error("The upload was interrupted. Check your connection and try again."));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
}

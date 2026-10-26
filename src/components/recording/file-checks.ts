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
 * Sends the file to the workspace's storage with progress. With Blob storage (production) the browser
 * writes it straight to the container (see uploadDirect); otherwise to POST /api/uploads.
 */
export async function uploadToStorage(file: Blob, fileName: string, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<StoredUpload> {
  return (await directUploadsOn()) ? uploadDirect(file, fileName, onProgress, signal) : uploadThroughApp(file, fileName, onProgress, signal);
}

let directOn: Promise<boolean> | null = null;
/** Asked once per page load; any failure means the usual path. */
function directUploadsOn(): Promise<boolean> {
  directOn ??= fetch("/api/uploads/direct", { cache: "no-store" })
    .then(async (r) => (r.ok ? ((await r.json()) as { enabled?: boolean }).enabled === true : false))
    .catch(() => false);
  return directOn;
}

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  const json = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!res.ok || !json) throw new Error(json?.message ?? `Upload failed (${res.status}).`);
  return json;
}

interface DirectStart { storageKey: string; uploadUrl: string; expiresAt: string; ticket: string; blockBytes?: number }

/** Same-length block ids, as Put Block List requires: "block-000001" in base64. */
export const blockId = (i: number) => btoa(`block-${String(i).padStart(6, "0")}`);

export function blockListXml(count: number) {
  return `<?xml version="1.0" encoding="utf-8"?><BlockList>${Array.from({ length: count }, (_, i) => `<Latest>${blockId(i)}</Latest>`).join("")}</BlockList>`;
}

/**
 * Direct upload to Blob storage: the app hands out a 15-minute, create-only SAS URL for one new blob,
 * the browser sends the file in 8 MB blocks (Put Block, 4 at a time, each retried) and commits them
 * (Put Block List), then the app checks the blob's size and hashes it (complete). The URL is renewed
 * while a long upload runs. Large files never pass through the app server.
 */
export async function uploadDirect(file: Blob, fileName: string, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<StoredUpload> {
  const type = file.type || "application/octet-stream";
  let grant = await postJson<DirectStart>("/api/uploads/direct", { fileName, mimeType: type, size: file.size }, signal);
  const size = grant.blockBytes ?? 8 * 1024 * 1024;
  const count = Math.max(1, Math.ceil(file.size / size));
  const url = async () => {
    // Renew when less than 2 minutes are left, so no block starts on an expired link.
    if (Date.parse(grant.expiresAt) - Date.now() < 2 * 60_000) grant = await postJson<DirectStart>("/api/uploads/direct", { storageKey: grant.storageKey, ticket: grant.ticket }, signal);
    return grant.uploadUrl;
  };
  const put = async (query: string, body: Blob | string, headers: Record<string, string>) => {
    for (let attempt = 1; ; attempt++) {
      const target = `${await url()}&${query}`;
      let res: Response | null = null;
      try {
        res = await fetch(target, { method: "PUT", body, headers, signal });
      } catch {
        if (signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");
        if (attempt >= 3) throw new Error("The upload was interrupted. Check your connection and try again.");
      }
      if (res?.ok) return;
      // A 4xx other than a timeout or throttle won't get better with a retry. Storage's own error text isn't shown.
      if (res && ((res.status < 500 && res.status !== 408 && res.status !== 429) || attempt >= 3)) {
        throw new Error(`Storage refused the upload (${res.status}). Try again, or ask an administrator to check the storage settings.`);
      }
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  };
  let sent = 0, next = 0;
  const worker = async () => {
    while (next < count) {
      const i = next++;
      const part = file.slice(i * size, Math.min(file.size, (i + 1) * size));
      await put(`comp=block&blockid=${encodeURIComponent(blockId(i))}`, part, {});
      sent += part.size;
      onProgress(file.size ? sent / file.size : 1);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, count) }, worker));
  await put("comp=blocklist", blockListXml(count), { "content-type": "application/xml", "x-ms-blob-content-type": type });
  return postJson<StoredUpload>("/api/uploads/direct/complete", { storageKey: grant.storageKey, ticket: grant.ticket }, signal);
}

/** POST /api/uploads: the file itself is the request body (no form), so the server can stream it to storage at any size. */
function uploadThroughApp(file: Blob, fileName: string, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<StoredUpload> {
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

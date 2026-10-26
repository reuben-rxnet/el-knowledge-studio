import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_UPLOAD_LIMITS } from "@/lib/validation/upload-limits";

/**
 * Direct-to-Blob upload end to end against the Azurite emulator (AZURITE_TEST=1, see docs/deployment.md):
 * the browser code (uploadDirect) PUTs blocks to a real SAS URL, the app completes it.
 * The two app routes are stood in for by calling the same server functions they call.
 */
describe.skipIf(process.env.AZURITE_TEST !== "1")("direct upload: azure-blob (Azurite)", () => {
  let storage: typeof import("@/lib/services/storage");
  let direct: typeof import("@/server/direct-upload");
  let client: typeof import("@/components/recording/file-checks");
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    vi.resetModules();
    for (const [k, v] of Object.entries({ STORAGE_PROVIDER: "azure-blob", AZURE_STORAGE_CONNECTION_STRING: "UseDevelopmentStorage=true", AZURE_STORAGE_CONTAINER: `direct-${Date.now()}` })) vi.stubEnv(k, v);
    storage = await import("@/lib/services/storage");
    direct = await import("@/server/direct-upload");
    client = await import("@/components/recording/file-checks");
    const grants = new Map<string, string>();
    vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
      if (!input.startsWith("/api/")) return realFetch(input, init);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });
      try {
        if (input === "/api/uploads/direct/complete") return json(await direct.completeDirectUpload(direct.ticketFor(body.ticket, { userId: "u1", workspaceId: "ws1" }, body.storageKey), DEFAULT_UPLOAD_LIMITS));
        const key = (body.storageKey as string | undefined) ?? storage.storageKeyFor("ws1", String(body.fileName));
        const ticket = (body.ticket as string | undefined) ?? direct.signTicket({ key, uid: "u1", ws: "ws1", name: String(body.fileName), type: String(body.mimeType), exp: Date.now() + 60_000 });
        const { url, expiresOn } = await storage.directUploadUrl(key);
        grants.set(key, url);
        return json({ storageKey: key, uploadUrl: url, expiresAt: expiresOn.toISOString(), ticket, blockBytes: 64 * 1024 }); // small blocks: several per test file
      } catch (e) {
        return json({ message: e instanceof Error ? e.message : "failed" }, 400);
      }
    });
    (globalThis as { __grants?: Map<string, string> }).__grants = grants;
  });
  afterAll(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("uploads in blocks with progress, commits, and completes with the right size and hash", async () => {
    const data = Buffer.alloc(300 * 1024 + 123);
    for (let i = 0; i < data.length; i++) data[i] = (i * 31) % 251;
    const progress: number[] = [];
    const r = await client.uploadDirect(new Blob([data], { type: "video/mp4" }), "clip one.mp4", (f) => progress.push(f));
    expect(r.sizeBytes).toBe(data.length);
    expect(r.checksum).toBe(createHash("sha256").update(data).digest("hex"));
    expect(r.storageKey.startsWith("ws1/")).toBe(true);
    expect(progress.length).toBe(5); // 5 blocks of 64 KB
    expect(progress.at(-1)).toBe(1);
    expect((await storage.readStoredFile(r.storageKey)).equals(data)).toBe(true);

    // Write-only: the link can't read the file back, delete it, or reach any other blob.
    const url = (globalThis as { __grants?: Map<string, string> }).__grants!.get(r.storageKey)!;
    expect((await realFetch(url)).status).toBe(403);
    expect((await realFetch(url, { method: "DELETE" })).status).toBe(403);
    const other = url.replace(/\/ws1\/[^?]+/, "/ws1/someone-else.mp4");
    expect((await realFetch(other, { method: "PUT", body: "x", headers: { "x-ms-blob-type": "BlockBlob" } })).status).toBe(403);
    expect((await storage.readStoredFile(r.storageKey)).equals(data)).toBe(true);
  });

  it("an expired link is refused", async () => {
    const key = storage.storageKeyFor("ws1", "late.mp4");
    const { url } = await storage.directUploadUrl(key, new Date(Date.now() - 60 * 60_000));
    expect((await realFetch(url, { method: "PUT", body: "x", headers: { "x-ms-blob-type": "BlockBlob" } })).status).toBe(403);
    expect(await storage.storedFileExists(key)).toBe(false);
  });

  it("deletes an upload over its limit when completing it", async () => {
    const key = storage.storageKeyFor("ws1", "notes.txt");
    await storage.saveFile(key, Buffer.alloc(2 * 1024 * 1024, 65), "text/plain");
    const t = { key, uid: "u1", ws: "ws1", name: "notes.txt", type: "text/plain", exp: Date.now() + 60_000 };
    await expect(direct.completeDirectUpload(t, { ...DEFAULT_UPLOAD_LIMITS, text: 1 })).rejects.toThrow("can be up to 1 MB");
    expect(await storage.storedFileExists(key)).toBe(false);
  });
});

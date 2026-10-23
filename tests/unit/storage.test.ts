import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The same storage contract on both providers. Local always runs; Azure Blob runs against the
 * Azurite emulator when AZURITE_TEST=1 (docker run -p 10000:10000 mcr.microsoft.com/azure-storage/azurite azurite-blob --blobHost 0.0.0.0).
 */
const AZURITE = "UseDevelopmentStorage=true"; // the SDK's shortcut for the local Azurite emulator

const providers: { name: string; env: Record<string, string>; enabled: boolean }[] = [
  { name: "local", env: { STORAGE_PROVIDER: "local" }, enabled: true },
  { name: "azure-blob", env: { STORAGE_PROVIDER: "azure-blob", AZURE_STORAGE_CONNECTION_STRING: AZURITE, AZURE_STORAGE_CONTAINER: `test-${Date.now()}` }, enabled: process.env.AZURITE_TEST === "1" },
];

for (const p of providers) {
  describe.skipIf(!p.enabled)(`storage: ${p.name}`, () => {
    let dir: string;
    let s: typeof import("@/lib/services/storage");
    beforeAll(async () => {
      dir = await mkdtemp(path.join(os.tmpdir(), "elks-storage-test-"));
      vi.resetModules();
      for (const [k, v] of Object.entries({ ...p.env, STORAGE_DIR: dir })) vi.stubEnv(k, v);
      s = await import("@/lib/services/storage");
    });
    afterAll(async () => {
      vi.unstubAllEnvs();
      await rm(dir, { recursive: true, force: true });
    });

    it("saves, sizes, reads, streams ranges and lends a local copy", async () => {
      const key = s.storageKeyFor("ws1", "clip one.mp4");
      expect(s.keyBelongsTo(key, "ws1")).toBe(true);
      expect(await s.storedFileExists(key)).toBe(false);
      const data = Buffer.from("0123456789abcdef");
      await s.saveFile(key, data, "video/mp4");
      expect(await s.storedFileSize(key)).toBe(16);
      expect((await s.readStoredFile(key)).toString()).toBe("0123456789abcdef");
      const part = Buffer.from(await new Response(await s.streamStoredFile(key, 4, 9)).arrayBuffer()).toString();
      expect(part).toBe("456789");
      const viaFile = await s.withLocalFile(key, async (f) => (await readFile(f)).toString());
      expect(viaFile).toBe("0123456789abcdef");
      expect(await s.storageReady()).toBe(true);
    });

    it("rejects keys that try to leave the workspace area", async () => {
      await expect(s.readStoredFile("../etc/passwd")).rejects.toThrow("Invalid storage key");
      await expect(s.saveFile("ws1/../../x", Buffer.from("x"))).rejects.toThrow("Invalid storage key");
    });
  });
}

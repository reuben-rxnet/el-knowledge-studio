import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The database rows that refer to storage keys; the files themselves live in a temporary STORAGE_DIR.
const refs = vi.hoisted(() => ({
  sources: [] as { storageKey: string; pageImages: string | null }[],
  renders: [] as { outputKey: string | null; captionTracks: string | null }[],
  steps: [] as { screenshotKey: string | null }[],
  music: [] as { storageKey: string }[],
}));
vi.mock("@/lib/database/client", () => ({
  db: {
    sourceAsset: { findMany: async () => refs.sources },
    renderJob: { findMany: async () => refs.renders },
    guideStep: { findMany: async () => refs.steps },
  },
}));
vi.mock("@/server/settings", () => ({ getUploadedMusic: async () => refs.music }));

describe("storage clean-up", () => {
  let dir: string;
  let cleanup: typeof import("@/server/cleanup");
  let storage: typeof import("@/lib/services/storage");
  const old = new Date(Date.now() - 3 * 86_400_000);

  async function plant(key: string, age: Date | null = old, bytes = 10) {
    const file = path.join(dir, key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, Buffer.alloc(bytes));
    if (age) await utimes(file, age, age);
  }

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "elks-cleanup-test-"));
    vi.resetModules();
    vi.stubEnv("STORAGE_PROVIDER", "local");
    vi.stubEnv("STORAGE_DIR", dir);
    storage = await import("@/lib/services/storage");
    cleanup = await import("@/server/cleanup");
    await plant("ws1/aaa-source.mp4");
    await plant("ws1/bbb-page-001.png");
    await plant("ws1/ccc-render.mp4");
    await plant("ws1/ddd-render.en.vtt");
    await plant("ws1/eee-step.png");
    await plant("platform/fff-music.mp3");
    await plant("ws1/orphan-one.mp4", old, 1000);
    await plant("ws2/orphan-two.png", new Date(Date.now() - 10 * 86_400_000), 24);
    await plant("ws1/fresh-upload.mp4", null); // the wizard may still be open
    await plant("ws1/uploading.mp4.partial");
    await plant("knowzy/retail/p1.en.md"); // not a storage key: never listed
    refs.sources = [{ storageKey: "ws1/aaa-source.mp4", pageImages: JSON.stringify(["ws1/bbb-page-001.png"]) }];
    refs.renders = [{ outputKey: "ws1/ccc-render.mp4", captionTracks: JSON.stringify([{ language: "en", key: "ws1/ddd-render.en.vtt" }]) }, { outputKey: null, captionTracks: null }];
    refs.steps = [{ screenshotKey: "ws1/eee-step.png" }];
    refs.music = [{ storageKey: "platform/fff-music.mp3" }];
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  it("lists stored files with size and date, only valid keys", async () => {
    const files = await storage.listStoredFiles();
    expect(files.map((f) => f.key).sort()).toEqual([
      "platform/fff-music.mp3", "ws1/aaa-source.mp4", "ws1/bbb-page-001.png", "ws1/ccc-render.mp4", "ws1/ddd-render.en.vtt", "ws1/eee-step.png",
      "ws1/fresh-upload.mp4", "ws1/orphan-one.mp4", "ws1/uploading.mp4.partial", "ws2/orphan-two.png",
    ]);
    expect((await storage.listStoredFiles("ws2/")).map((f) => f.key)).toEqual(["ws2/orphan-two.png"]);
    expect(files.find((f) => f.key === "ws1/orphan-one.mp4")).toMatchObject({ size: 1000 });
  });

  it("finds only unreferenced files older than the window, skipping partial uploads", async () => {
    const r = await cleanup.findOrphans();
    expect(r.files.map((f) => f.key)).toEqual(["ws2/orphan-two.png", "ws1/orphan-one.mp4"]); // oldest first
    expect(r).toMatchObject({ count: 2, totalBytes: 1024 });
    expect(r.oldest!.getTime()).toBeLessThan(old.getTime());
    expect((await cleanup.findOrphans({ olderThanHours: 24 * 5 })).files.map((f) => f.key)).toEqual(["ws2/orphan-two.png"]);
  });

  it("checks references again when deleting", async () => {
    refs.sources.push({ storageKey: "ws1/orphan-one.mp4", pageImages: "not json" }); // became referenced since the admin looked
    expect(await cleanup.deleteOrphans()).toEqual({ deleted: 1, bytes: 24, failed: 0 });
    expect(await storage.storedFileExists("ws2/orphan-two.png")).toBe(false);
    expect(await storage.storedFileExists("ws1/orphan-one.mp4")).toBe(true);
    expect(await storage.storedFileExists("ws1/fresh-upload.mp4")).toBe(true);
    expect((await cleanup.findOrphans()).count).toBe(0);
  });
});

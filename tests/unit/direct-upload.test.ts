import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StorageSharedKeyCredential, type UserDelegationKey } from "@azure/storage-blob";
import { signUploadUrl, uploadSasWindow, UPLOAD_SAS_MINUTES } from "@/lib/services/blob-sas";
import { DEFAULT_UPLOAD_LIMITS } from "@/lib/validation/upload-limits";
import { blockId, blockListXml } from "@/components/recording/file-checks";

// The storage layer is mocked: these tests check what complete does with a blob, not Blob itself
// (tests/unit/direct-upload-azurite.test.ts runs the real thing against the emulator).
const store = new Map<string, Buffer>();
const deleted: string[] = [];
vi.mock("@/lib/services/storage", () => ({
  keyBelongsTo: (key: string, ws: string) => key.startsWith(`${ws}/`),
  storedFileSize: async (key: string) => store.get(key)?.length ?? null,
  deleteStoredFile: async (key: string) => { deleted.push(key); store.delete(key); },
  streamStoredFile: async (key: string, start: number, end: number) => {
    const buf = store.get(key)!.subarray(start, end + 1);
    // Two chunks, so the hash really is built from a stream.
    const mid = Math.floor(buf.length / 2);
    return new ReadableStream<Uint8Array>({ start(c) { c.enqueue(buf.subarray(0, mid)); c.enqueue(buf.subarray(mid)); c.close(); } });
  },
}));
const { completeDirectUpload, signTicket, ticketFor, verifyTicket } = await import("@/server/direct-upload");

const params = (url: string) => new URL(url).searchParams;
const NOW = new Date("2026-10-26T10:00:00Z");
const window = uploadSasWindow(NOW);

describe("direct upload SAS URLs", () => {
  it("account key (emulator): one blob, create and write only, 15 minutes", () => {
    const cred = new StorageSharedKeyCredential("devstoreaccount1", Buffer.from("not-a-real-key-0123456789").toString("base64"));
    const url = signUploadUrl("http://127.0.0.1:10000/devstoreaccount1/media/ws1/abc-clip.mp4", "media", "ws1/abc-clip.mp4", window, { kind: "account-key", credential: cred });
    const q = params(url);
    expect(url.startsWith("http://127.0.0.1:10000/devstoreaccount1/media/ws1/abc-clip.mp4?")).toBe(true);
    expect(q.get("sp")).toBe("cw"); // no read, delete or list
    expect(q.get("sr")).toBe("b"); // this blob, not the container
    expect(q.get("spr")).toBe("https,http"); // the emulator is plain HTTP
    expect(q.get("sig")).toBeTruthy();
    expect(Date.parse(q.get("se")!) - NOW.getTime()).toBe(UPLOAD_SAS_MINUTES * 60_000);
    expect(NOW.getTime() - Date.parse(q.get("st")!)).toBe(5 * 60_000); // clock skew allowance
    expect(q.get("skoid")).toBeNull();
  });

  it("user delegation key (managed identity in Azure): HTTPS only, signed by the delegation key", () => {
    const key: UserDelegationKey = {
      signedObjectId: "11111111-1111-1111-1111-111111111111", signedTenantId: "22222222-2222-2222-2222-222222222222",
      signedStartsOn: new Date("2026-10-26T09:55:00Z"), signedExpiresOn: new Date("2026-10-26T16:00:00Z"),
      signedService: "b", signedVersion: "2025-01-05", value: Buffer.from("delegation-key-value").toString("base64"),
    };
    const url = signUploadUrl("https://stelks.blob.core.windows.net/media/ws1/abc-clip.mp4", "media", "ws1/abc-clip.mp4", window, { kind: "user-delegation", key, accountName: "stelks" });
    const q = params(url);
    expect(q.get("sp")).toBe("cw");
    expect(q.get("sr")).toBe("b");
    expect(q.get("spr")).toBe("https");
    expect(q.get("skoid")).toBe(key.signedObjectId);
    expect(q.get("sktid")).toBe(key.signedTenantId);
    expect(q.get("sig")).toBeTruthy();
  });
});

describe("direct upload tickets", () => {
  const session = { userId: "u1", workspaceId: "ws1" };
  const t = { key: "ws1/abc-clip.mp4", uid: "u1", ws: "ws1", name: "clip.mp4", type: "video/mp4", exp: Date.now() + 60_000 };

  it("accepts the user's own ticket for the same key", () => {
    expect(ticketFor(signTicket(t), session, t.key)).toMatchObject({ key: t.key, name: "clip.mp4" });
  });

  it("refuses tampered, expired, someone else's or another workspace's tickets", () => {
    const token = signTicket(t);
    const [body, sig] = token.split(".");
    const forged = `${Buffer.from(JSON.stringify({ ...t, key: "ws1/someone-elses.mp4" })).toString("base64url")}.${sig}`;
    expect(verifyTicket(forged)).toBeNull();
    expect(verifyTicket(`${body}.x${sig}`)).toBeNull();
    expect(verifyTicket(signTicket({ ...t, exp: Date.now() - 1 }))).toBeNull();
    expect(() => ticketFor(token, { ...session, userId: "u2" }, t.key)).toThrow("isn't yours");
    expect(() => ticketFor(token, { ...session, workspaceId: "ws2" }, t.key)).toThrow("isn't yours");
    expect(() => ticketFor(token, session, "ws1/other.mp4")).toThrow("isn't yours");
    expect(() => ticketFor(signTicket({ ...t, key: "ws2/x.mp4", ws: "ws1" }), session, "ws2/x.mp4")).toThrow("isn't yours"); // key outside the workspace
  });
});

describe("completing a direct upload", () => {
  beforeEach(() => { store.clear(); deleted.length = 0; });
  const ticket = (name: string, type: string) => ({ key: `ws1/abc-${name}`, uid: "u1", ws: "ws1", name, type, exp: Date.now() + 60_000 });

  it("hashes the stored blob and returns the same shape as /api/uploads", async () => {
    const data = Buffer.from("fake mp4 bytes ".repeat(1000));
    store.set("ws1/abc-clip.mp4", data);
    const r = await completeDirectUpload(ticket("clip.mp4", "video/mp4"), DEFAULT_UPLOAD_LIMITS);
    expect(r).toEqual({ storageKey: "ws1/abc-clip.mp4", fileName: "clip.mp4", mimeType: "video/mp4", sizeBytes: data.length, checksum: createHash("sha256").update(data).digest("hex"), kind: "video" });
  });

  it("refuses a blob that never arrived", async () => {
    await expect(completeDirectUpload(ticket("clip.mp4", "video/mp4"), DEFAULT_UPLOAD_LIMITS)).rejects.toThrow("didn't arrive");
  });

  it("deletes a blob over its type's limit (the declared size can't be trusted)", async () => {
    store.set("ws1/abc-notes.txt", Buffer.alloc(2 * 1024 * 1024, 65));
    await expect(completeDirectUpload(ticket("notes.txt", "text/plain"), { ...DEFAULT_UPLOAD_LIMITS, text: 1 })).rejects.toThrow("can be up to 1 MB");
    expect(deleted).toEqual(["ws1/abc-notes.txt"]);
  });

  it("deletes an empty blob", async () => {
    store.set("ws1/abc-clip.mp4", Buffer.alloc(0));
    await expect(completeDirectUpload(ticket("clip.mp4", "video/mp4"), DEFAULT_UPLOAD_LIMITS)).rejects.toThrow("empty");
    expect(deleted).toEqual(["ws1/abc-clip.mp4"]);
  });
});

describe("Put Block List", () => {
  it("uses same-length block ids, in order", () => {
    expect(atob(blockId(0))).toBe("block-000000");
    expect(blockId(7).length).toBe(blockId(123456).length);
    expect(blockListXml(2)).toBe(`<?xml version="1.0" encoding="utf-8"?><BlockList><Latest>${blockId(0)}</Latest><Latest>${blockId(1)}</Latest></BlockList>`);
  });
});

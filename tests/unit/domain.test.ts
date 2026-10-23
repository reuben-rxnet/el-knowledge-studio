import { describe, expect, it } from "vitest";
import { can, permissionsFor, ROLE_PERMISSIONS } from "@/lib/permissions";
import { isDemoAuthEnabled } from "@/lib/auth/demo";
import { CLASSIFICATION_POLICY, freshnessOf } from "@/lib/domain/constants";
import { snapshotJob, STAGES } from "@/lib/services/processing-plan";
import { createProjectSchema, decisionSchema, validateUpload } from "@/lib/validation/schemas";
import { generatedContentSchema } from "@/lib/services/interfaces";
import { mockGroundedAnswer, mockGuideGenerator, mockScriptService } from "@/lib/services/mock";

describe("capability-based permissions", () => {
  it("grants by capability, not role name", () => {
    expect(can(["consumer"], "project.view")).toBe(true);
    expect(can(["consumer"], "project.create")).toBe(false);
    expect(can(["creator"], "review.approve")).toBe(false);
    expect(can(["reviewer"], "review.approve")).toBe(true);
    expect(can(["publisher"], "publish.execute")).toBe(true);
    expect(can(["creator", "translator"], "translation.edit")).toBe(true);
  });
  it("only administrators and auditors can read the audit history", () => {
    const withAudit = Object.entries(ROLE_PERMISSIONS).filter(([, p]) => p.includes("audit.view")).map(([r]) => r).sort();
    expect(withAudit).toEqual(["auditor", "enterprise-admin", "workspace-admin"]);
  });
  it("ignores unknown roles", () => expect(permissionsFor(["superuser"]).size).toBe(0));
});

describe("demo authentication guard", () => {
  it("is refused in production even when configured", () => {
    expect(isDemoAuthEnabled({ AUTH_PROVIDER: "demo", NODE_ENV: "production" })).toBe(false);
    expect(isDemoAuthEnabled({ AUTH_PROVIDER: "demo", NODE_ENV: "development" })).toBe(true);
    expect(isDemoAuthEnabled({ AUTH_PROVIDER: "entra", NODE_ENV: "development" })).toBe(false);
  });
});

describe("processing pipeline (deterministic, idempotent snapshots)", () => {
  const startedAt = new Date("2026-10-01T10:00:00Z");
  const at = (ms: number) => new Date(startedAt.getTime() + ms);
  it("progresses through all 16 stages in order", () => {
    expect(STAGES).toHaveLength(16);
    const early = snapshotJob({ status: "running", startedAt, simulatedMs: 24_000 }, at(1000));
    expect(early.status).toBe("running");
    expect(early.stages[0]!.status).toBe("running");
    expect(early.stages.at(-1)!.status).toBe("queued");
    const done = snapshotJob({ status: "running", startedAt, simulatedMs: 24_000 }, at(30_000));
    expect(done.status).toBe("succeeded");
    expect(done.percent).toBe(100);
    expect(done.stages.every((s) => s.status === "succeeded")).toBe(true);
  });
  it("gives the same answer to every poller at the same moment", () => {
    const a = snapshotJob({ status: "running", startedAt, simulatedMs: 24_000 }, at(12_345));
    const b = snapshotJob({ status: "running", startedAt, simulatedMs: 24_000 }, at(12_345));
    expect(a).toEqual(b);
  });
  it("keeps cancelled and failed jobs terminal", () => {
    expect(snapshotJob({ status: "cancelled", startedAt, simulatedMs: 24_000 }, at(5000)).status).toBe("cancelled");
    expect(snapshotJob({ status: "failed", startedAt, simulatedMs: 24_000 }, at(5000)).stages.some((s) => s.status === "failed")).toBe(true);
  });
});

describe("validation", () => {
  const base = {
    sourceKind: "recording", outputs: ["video"], title: "Store closing", description: "", businessFunction: "Retail Operations", processCategory: "Ops",
    region: "Europe", country: "Italy", sourceSystem: "", audience: "Managers", classification: "Internal", smeName: "", approverName: "",
    primaryLanguage: "en", targetLanguages: ["fr"], destinations: ["sharepoint"], reviewFrequencyDays: 180, templateKey: "retail",
  };
  it("accepts a complete project", () => expect(createProjectSchema.safeParse(base).success).toBe(true));
  it("refuses Restricted content and the primary language as a target", () => {
    expect(createProjectSchema.safeParse({ ...base, classification: "Restricted" }).success).toBe(false);
    expect(createProjectSchema.safeParse({ ...base, targetLanguages: ["en"] }).success).toBe(false);
  });
  it("requires a justification to request changes", () => {
    const id = "cl0123456789abcdefghijklm";
    expect(decisionSchema.safeParse({ reviewId: id, expectedVersion: 1, decision: "request-changes", justification: "" }).success).toBe(false);
    expect(decisionSchema.safeParse({ reviewId: id, expectedVersion: 1, decision: "approve", justification: "" }).success).toBe(true);
  });
  it("validates upload type, MIME and size", () => {
    expect(validateUpload({ name: "a.mp4", type: "video/mp4", size: 10 }).ok).toBe(true);
    expect(validateUpload({ name: "a.exe", type: "", size: 10 })).toMatchObject({ ok: false, code: "UNSUPPORTED_TYPE" });
    expect(validateUpload({ name: "a.mp4", type: "application/pdf", size: 10 })).toMatchObject({ ok: false, code: "TYPE_MISMATCH" });
    expect(validateUpload({ name: "a.pdf", type: "application/pdf", size: 0 })).toMatchObject({ ok: false, code: "EMPTY_FILE" });
    expect(validateUpload({ name: "a.pdf", type: "application/pdf", size: 11 }, 10)).toMatchObject({ ok: false, code: "TOO_LARGE" });
  });
  it("blocks external sharing destinations by classification", () => {
    expect(CLASSIFICATION_POLICY["Highly Confidential"].destinations).toEqual(["sharepoint"]);
    expect(CLASSIFICATION_POLICY.Restricted.recording).toBe(false);
  });
  it("computes freshness from the next review date", () => {
    const now = new Date("2026-10-22");
    expect(freshnessOf(new Date("2027-03-01"), "published", now)).toBe("current");
    expect(freshnessOf(new Date("2026-11-01"), "published", now)).toBe("due-soon");
    expect(freshnessOf(new Date("2026-10-01"), "published", now)).toBe("overdue");
    expect(freshnessOf(new Date("2026-06-01"), "published", now)).toBe("expired");
  });
});

describe("mock AI services", () => {
  it("produce schema-valid guide content", async () => {
    const out = await mockGuideGenerator.generate({ title: "X", description: "", businessFunction: "Finance", sourceSystem: "SAP S/4HANA", audience: "Controllers", primaryLanguage: "en", durationSec: 300, protectedTerms: ["SAP S/4HANA"] });
    expect(generatedContentSchema.safeParse(out).success).toBe(true);
  });
  it("never drop protected terms when rewriting", async () => {
    const t = await mockScriptService.rewrite("Open Store Portal. Then basically select Day Operations.", "shorten", ["Store Portal"]);
    expect(t).toContain("Store Portal");
  });
  it("refuse to answer without enough evidence", async () => {
    expect(await mockGroundedAnswer.answer("tax refund for expatriates", [{ projectId: "p", stepId: "s", text: "Open the POS day\nSelect Open Day." }])).toMatchObject({ sufficient: false, answer: null });
    const ok = await mockGroundedAnswer.answer("open the POS day", [{ projectId: "p", stepId: "s", text: "Title · Step 1: Open the POS day\nSelect Day Operations, then Open Day." }]);
    expect(ok.sufficient).toBe(true);
    expect(ok.citations).toEqual([{ projectId: "p", stepId: "s" }]);
  });
});

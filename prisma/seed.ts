import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PROJECTS, TEMPLATES, USERS, WORKSPACES } from "./seed-data";

const db = new PrismaClient();
const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY);

async function wipe() {
  // Child tables first. AuditEvent is append-only in the app; the seed resets the whole demo database.
  await db.$transaction([
    db.auditEvent.deleteMany(), db.notification.deleteMany(), db.searchFeedback.deleteMany(), db.featureFlag.deleteMany(),
    db.comment.deleteMany(), db.reviewRequest.deleteMany(), db.publishingJob.deleteMany(), db.translationProject.deleteMany(),
    db.renderJob.deleteMany(), db.reviewFlag.deleteMany(), db.quizQuestion.deleteMany(), db.translationSegment.deleteMany(),
    db.faqItem.deleteMany(), db.guideStep.deleteMany(), db.scriptSegment.deleteMany(), db.scene.deleteMany(),
    db.processingJob.deleteMany(), db.sourceAsset.deleteMany(), db.projectVersion.deleteMany(), db.project.deleteMany(),
    db.template.deleteMany(), db.workspaceMembership.deleteMany(), db.user.deleteMany(), db.workspace.deleteMany(),
  ]);
}

async function main() {
  await wipe();

  const ws: Record<string, string> = {};
  for (const w of WORKSPACES) ws[w.slug] = (await db.workspace.create({ data: w })).id;

  const users: Record<string, { id: string; name: string }> = {};
  for (const u of USERS) {
    const created = await db.user.create({
      data: { email: u.email, displayName: u.displayName, initials: u.initials, jobTitle: u.jobTitle, location: u.location, isEnterpriseAdmin: "enterprise" in u && u.enterprise === true },
    });
    users[u.key] = { id: created.id, name: u.displayName };
    for (const [slug, roles] of Object.entries(u.memberships)) {
      await db.workspaceMembership.create({ data: { userId: created.id, workspaceId: ws[slug]!, roles } });
    }
  }
  const U = (k: string) => users[k]!;

  for (const [key, name, businessFunction, outputs, approvalWorkflow, defaultDestination] of TEMPLATES) {
    await db.template.create({ data: { key, name, description: `${name} with governed outputs and ${approvalWorkflow} approval.`, businessFunction, outputs, approvalWorkflow, defaultDestination, structure: "purpose,prerequisites,procedure,warnings,faq" } });
  }

  const byKey: Record<string, string> = {};
  for (const p of PROJECTS) {
    const owner = U(p.owner);
    const project = await db.project.create({
      data: {
        workspaceId: ws[p.ws]!, title: p.title, description: p.summary, businessFunction: p.fn, processCategory: p.category, region: p.region, country: p.country,
        sourceSystem: p.system, audience: p.audience, classification: p.cls, primaryLanguage: p.lang, targetLanguages: p.targets.join(","), destinations: p.destinations.join(","),
        outputs: "video,guide,article,faq,subtitles", templateKey: p.template, sourceKind: "recording", status: p.status, ownerId: owner.id,
        backupOwnerName: "Daniel Okafor", smeName: p.sme, approverName: p.approver, reviewFrequencyDays: 180,
        lastReviewedAt: ago(180 - p.nextReviewDays), nextReviewAt: new Date(Date.now() + p.nextReviewDays * DAY), effectiveAt: ago(30 + p.updatedDaysAgo),
        currentVersion: p.version, approvedVersion: p.approvedV, publishedVersion: p.publishedV, durationSec: p.dur, views: p.views, hue: p.hue,
        createdAt: ago(60 + p.updatedDaysAgo), updatedAt: ago(p.updatedDaysAgo), createdById: owner.id, updatedById: owner.id,
      },
    });
    byKey[p.key] = project.id;

    for (let v = 1; v <= p.version; v++) {
      const status = v === p.version ? p.status : v === p.publishedV ? "published" : v === p.approvedV ? "approved" : "archived";
      await db.projectVersion.create({ data: { projectId: project.id, number: v, status, note: v === 1 ? "Generated from the original recording" : `Revision ${v}`, createdById: owner.id, createdAt: ago(60 - v * 7 + p.updatedDaysAgo) } });
    }
    await db.sourceAsset.create({ data: { projectId: project.id, kind: "recording", fileName: `${p.key}-recording.webm`, mimeType: "video/webm", sizeBytes: p.dur * 420_000, durationSec: p.dur, checksum: randomUUID().replace(/-/g, ""), storageKey: `mock-${p.region.toLowerCase().replace(/\W+/g, "-")}/${p.key}.webm`, createdById: owner.id } });

    for (const [i, s] of p.steps.entries()) {
      const [chapter, title, instruction, sec, warning, tip] = s;
      const end = p.steps[i + 1]?.[3] ?? p.dur;
      await db.scene.create({ data: { projectId: project.id, order: i, title, summary: instruction.slice(0, 120), startSec: sec, endSec: end, focusZoom: i % 2 === 0, redaction: i === 2 } });
      await db.scriptSegment.create({
        data: { projectId: project.id, order: i, startSec: sec, endSec: end, originalText: `So, um, here we ${title.toLowerCase()}. You basically just ${instruction.charAt(0).toLowerCase()}${instruction.slice(1)}`, text: instruction, origin: "ai", locked: p.status === "published", flagged: i === 2 ? p.system : null },
      });
      await db.guideStep.create({
        data: { projectId: project.id, order: i, chapter, title, instruction, expectedResult: `${title} is complete in ${p.system}.`, warning: warning ?? null, tip: tip ?? null, altText: `Screenshot of ${p.system}: ${title.toLowerCase()}`, sourceSec: sec, origin: "ai", markerX: 30 + ((i * 17) % 45), markerY: 30 + ((i * 23) % 40) },
      });
    }
    for (const s of p.steps.filter((x) => x[4])) {
      await db.faqItem.create({ data: { projectId: project.id, question: `What if something goes wrong when I ${s[1].charAt(0).toLowerCase()}${s[1].slice(1)}?`, answer: s[4]!, origin: "ai" } });
    }
  }

  const P = (k: string) => byKey[k]!;
  const firstStep = async (k: string, order: number) => (await db.guideStep.findFirstOrThrow({ where: { projectId: P(k), order } })).id;

  await db.comment.createMany({ data: [
    { projectId: P("store-opening"), authorId: U("pierre").id, body: "The variance threshold in French stores is €10, not €20. Can we make this region-aware?", anchorType: "step", anchorRef: await firstStep("store-opening", 2), anchorLabel: "Step 3", version: 3, createdAt: ago(0.15) },
    { projectId: P("store-opening"), authorId: U("amara").id, body: "Good catch. I'll add a regional note and keep €20 as the default for Italy.", anchorType: "step", anchorRef: await firstStep("store-opening", 2), anchorLabel: "Step 3", version: 3, createdAt: ago(0.1) },
    { projectId: P("quality-inspection"), authorId: U("pierre").id, body: "The defect-code list in scene 3 shows an old MES screen. Please re-record with the current release.", anchorType: "scene", anchorLabel: "Scene 3 · 03:30", timestampSec: 210, version: 4, createdAt: ago(2.5) },
  ] });

  await db.reviewRequest.createMany({ data: [
    { projectId: P("store-opening"), version: 3, stage: "sme", status: "open", assigneeId: U("pierre").id, requestedById: U("amara").id, dueAt: new Date(Date.now() + 2 * DAY) },
    { projectId: P("finance-close"), version: 5, stage: "approval", status: "open", assigneeId: U("chiara").id, requestedById: U("marc").id, dueAt: new Date(Date.now() + DAY) },
    { projectId: P("quality-inspection"), version: 4, stage: "sme", status: "changes-requested", assigneeId: U("pierre").id, requestedById: U("wei").id, dueAt: ago(2), createdAt: ago(5), decidedAt: ago(2.5), justification: "Re-record scene 3 with the current MES release." },
    { projectId: P("returns"), version: 2, stage: "approval", status: "approved", assigneeId: U("chiara").id, requestedById: U("anna").id, dueAt: ago(3), createdAt: ago(4.5), decidedAt: ago(2) },
  ] });

  await db.publishingJob.createMany({ data: [
    { projectId: P("onboarding"), version: 2, destination: "sharepoint", target: "EL Knowledge · HR Library", language: "en", audience: "All employees", status: "succeeded", createdById: U("sofia").id, createdAt: ago(9) },
    { projectId: P("onboarding"), version: 2, destination: "leonardo", target: "Learning catalogue", language: "en", audience: "New joiners", status: "succeeded", createdById: U("sofia").id, createdAt: ago(9) },
    { projectId: P("access-request"), version: 6, destination: "knowzy", target: "Knowledge base", language: "en", audience: "All employees", status: "succeeded", createdById: U("sofia").id, createdAt: ago(40) },
    { projectId: P("store-opening"), version: 2, destination: "teams", target: "Retail Europe · Store Standards", language: "en", audience: "Store managers", status: "succeeded", createdById: U("sofia").id, createdAt: ago(60) },
    { projectId: P("returns"), version: 1, destination: "sharepoint", target: "EL Knowledge · Retail Process Library", language: "de", audience: "Store associates", status: "succeeded", createdById: U("sofia").id, createdAt: ago(80) },
  ] });

  const tr = (k: string, language: string, status: string, reviewerName: string, completion: number, v: string, g: string, c: string, vo: string) =>
    ({ projectId: P(k), language, status, reviewerName, completion, videoStatus: v, guideStatus: g, captionStatus: c, voiceStatus: vo });
  await db.translationProject.createMany({ data: [
    tr("store-opening", "fr", "regional-review", "Camille Roux", 92, "Rendering", "In review", "Done", "Done"),
    tr("store-opening", "it", "approved", "Luca Romano", 100, "Done", "Done", "Done", "Done"),
    tr("store-opening", "de", "terminology", "Jonas Becker", 64, "Not started", "In progress", "Done", "Not started"),
    tr("store-opening", "es", "machine", "Lucía Navarro", 38, "Not started", "Machine draft", "Machine draft", "Not started"),
    tr("access-request", "ar", "approved", "Omar Khalil", 100, "Done", "Done", "Done", "Done"),
    tr("access-request", "ja", "regional-review", "Kenji Watanabe", 88, "Done", "In review", "Done", "Done"),
  ] });

  const wsOf = (k: string) => ws[PROJECTS.find((p) => p.key === k)!.ws]!;
  const audit = (days: number, actor: string, action: string, k: string, version: number, outcome = "success", justification?: string) => ({
    occurredAt: ago(days), actorId: U(actor).id, actorName: U(actor).name, action, resourceType: "project", resourceId: P(k),
    resourceLabel: PROJECTS.find((p) => p.key === k)!.title, resourceVersion: version, workspaceId: wsOf(k), outcome, correlationId: randomUUID(), justification: justification ?? null,
  });
  await db.auditEvent.createMany({ data: [
    audit(9.2, "chiara", "approval.granted", "onboarding", 2),
    audit(9, "sofia", "content.published", "onboarding", 2),
    audit(3, "leo", "content.downloaded", "finance-close", 5, "denied"),
    audit(2.5, "pierre", "approval.rejected", "quality-inspection", 4, "success", "Re-record scene 3 with the current MES release."),
    audit(1, "marc", "review.submitted", "finance-close", 5),
    audit(0.3, "amara", "content.edited", "store-opening", 3),
    audit(0.2, "amara", "review.submitted", "store-opening", 3),
    audit(0.15, "pierre", "comment.added", "store-opening", 3),
    audit(0.1, "amara", "comment.added", "store-opening", 3),
  ] });

  await db.notification.createMany({ data: [
    { userId: U("pierre").id, kind: "review.assigned", title: "Review assigned", body: "Retail Store Opening Checklist v3 is waiting for your SME review.", href: `/projects/${P("store-opening")}/review`, createdAt: ago(0.2) },
    { userId: U("chiara").id, kind: "review.assigned", title: "Approval requested", body: "Monthly Finance Closing Procedure v5 is waiting for your approval.", href: `/projects/${P("finance-close")}/review`, createdAt: ago(1) },
    { userId: U("amara").id, kind: "comment.mention", title: "Pierre commented on Step 3", body: "The variance threshold in French stores is €10, not €20.", href: `/projects/${P("store-opening")}/review`, createdAt: ago(0.15) },
    { userId: U("amara").id, kind: "processing.completed", title: "Draft ready", body: "Product Demonstration and Sales Enablement has a video, a guide and an article to review.", href: `/projects/${P("smart-eyewear-demo")}/video`, createdAt: ago(0.05) },
  ] });

  await db.featureFlag.createMany({ data: [
    { key: "voice-cloning", enabled: false, description: "Disabled. Requires legal, privacy, security and employee-consent review." },
    { key: "public-portal", enabled: false, description: "Controlled public portal destination. Disabled by default." },
    { key: "camera-overlay", enabled: false, description: "Camera overlay during recording. Future-ready, off." },
    { key: "studio-beta", enabled: true, description: "Studio (beta): the new timeline video editor, as a tab next to Video. The Video tab is unchanged." },
  ] });

  console.log(`Seeded ${WORKSPACES.length} workspaces, ${USERS.length} users, ${PROJECTS.length} projects.`);
}

main().then(() => db.$disconnect()).catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });

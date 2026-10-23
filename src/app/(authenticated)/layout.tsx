import { requirePageSession } from "@/lib/auth/session";
import { DEMO_PERSONAS, isDemoAuthEnabled } from "@/lib/auth/demo";
import { db } from "@/lib/database/client";
import { services } from "@/lib/services/registry";
import { AppShell, type NavKey } from "@/components/application-shell/app-shell";

export const dynamic = "force-dynamic";

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const s = await requirePageSession();
  const [reviews, notifications, jobs, personas] = await Promise.all([
    db.reviewRequest.count({ where: { assigneeId: s.user.id, status: "open", project: { workspaceId: s.workspace.id } } }),
    db.notification.findMany({ where: { userId: s.user.id }, orderBy: { createdAt: "desc" }, take: 8 }),
    db.processingJob.findMany({ where: { status: { in: ["queued", "running"] }, project: { workspaceId: s.workspace.id } }, include: { project: { select: { id: true, title: true } } }, take: 5 }),
    isDemoAuthEnabled() ? db.user.findMany({ where: { email: { in: DEMO_PERSONAS.map((p) => p.email) } }, select: { email: true, displayName: true } }) : Promise.resolve([]),
  ]);

  const p = s.permissions;
  const hidden: NavKey[] = [];
  if (!p.has("project.create")) hidden.push("create");
  if (!p.has("analytics.view")) hidden.push("analytics");
  if (!p.has("brand.manage")) hidden.push("brand");
  if (!p.has("workspace.manage")) hidden.push("admin");
  if (!p.has("audit.view")) hidden.push("audit");

  return (
    <AppShell
      user={{ name: s.user.displayName, initials: s.user.initials, email: s.user.email, title: s.user.jobTitle }}
      roles={s.roles}
      workspace={s.workspace}
      workspaces={s.workspaces}
      hidden={hidden}
      canCreate={p.has("project.create")}
      reviewCount={reviews}
      notifications={notifications.map((n) => ({ id: n.id, title: n.title, body: n.body, href: n.href, unread: !n.readAt, at: n.createdAt.toISOString() }))}
      jobs={jobs.map((j) => ({ id: j.id, projectId: j.project.id, title: j.project.title }))}
      personas={personas.map((u) => ({ email: u.email, name: u.displayName, label: DEMO_PERSONAS.find((d) => d.email === u.email)?.persona ?? "" }))}
      aiLabel={services.describe().label}
    >
      {children}
    </AppShell>
  );
}

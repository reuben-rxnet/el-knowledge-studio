import type { Metadata } from "next";
import { requirePageSession } from "@/lib/auth/session";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import { PageHeader } from "@/components/common/page-header";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const s = await requirePageSession();
  return (
    <section style={{ maxWidth: 900 }}>
      <PageHeader title="Settings" subtitle="Your profile and access in this workspace." />
      <div className="card pad">
        <dl className="dl">
          {([["Name", s.user.displayName], ["Email", s.user.email], ["Job title", s.user.jobTitle], ["Workspace", s.workspace.name], ["Roles", s.roles.map((r) => ROLE_LABELS[r as Role] ?? r).join(", ")], ["Permissions", [...s.permissions].join(", ")]] as [string, string][]).map(([k, v]) => <div key={k} style={{ display: "contents" }}><dt>{k}</dt><dd style={{ wordBreak: "break-word" }}>{v}</dd></div>)}
        </dl>
      </div>
      <p className="meta">The interface is in English. French, Italian, Spanish, German, Portuguese, Simplified Chinese, Japanese, Hindi and Arabic are planned and need professional language review first.</p>
    </section>
  );
}

import Link from "next/link";
import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { requirePageSession } from "@/lib/auth/session";
import { db } from "@/lib/database/client";
import { csv } from "@/lib/domain/constants";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import { aiProviderId, services } from "@/lib/services/registry";
import { loadOpenAIConfig } from "@/lib/services/openai/config";
import { sanitizeUrl } from "@/lib/services/openai/provider-request";
import { TonePill } from "@/components/common/badges";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { TestConnectionButton } from "@/components/admin/test-connection";
import { transcriptionModel } from "@/lib/services/openai/audio";
import { UploadLimitsForm } from "@/components/admin/upload-limits-form";
import { getUploadLimits, piiCodexEnabled, uploadCeilingMb, uploadLimitsChange } from "@/server/settings";
import { PiiCodexToggle } from "@/components/admin/pii-codex-toggle";
import { relativeTime } from "@/lib/utilities/format";

export const metadata: Metadata = { title: "Administration" };

function aiStatus() {
  if (aiProviderId() === "mock") return { rows: [["Provider", "Simulated AI (offline). No external calls."]] as [string, string][], ok: true };
  try {
    const c = loadOpenAIConfig();
    return {
      ok: !!c.approvalRef && !!process.env.OPENAI_API_KEY,
      rows: [
        ["Provider", "OpenAI Codex"], ["Endpoint", sanitizeUrl(c.baseUrl)], ["Model / deployment", c.modelId], ["API style", c.apiStyle],
        ["Credential", c.auth.location === "QUERY_PARAMETER" ? `Query parameter "${c.auth.parameterName}"` : `Header "${c.auth.headerName}"`],
        ["Key", process.env.OPENAI_API_KEY ? "Set (value never shown)" : "Missing: set OPENAI_API_KEY"],
        ["Fixed headers", Object.keys(c.extraHeaders).join(", ") || "none"], ["Allowed hosts", c.allowedHosts.join(", ")],
        ["Data-processing approval", c.approvalRef ?? "Not recorded. External AI is blocked."],
        ["Transcription", transcriptionModel() ? `Model ${transcriptionModel()}` : "Off: set OPENAI_TRANSCRIBE_MODEL if the gateway exposes an audio model"],
      ] as [string, string][],
    };
  } catch (e) {
    return { ok: false, rows: [["Provider", "OpenAI Codex"], ["Configuration", e instanceof Error ? e.message : "Invalid"]] as [string, string][] };
  }
}

export default async function AdminPage() {
  const s = await requirePageSession();
  if (!s.permissions.has("workspace.manage")) {
    return <section><div className="card"><EmptyState icon={Lock} title="Administration is for workspace administrators" action={<Link className="btn" href="/">Back to Home</Link>}>It needs the workspace.manage permission. In the demo, switch persona to Workspace administrator.</EmptyState></div></section>;
  }
  const [members, flags, limits, limitsChange, piiCodex] = await Promise.all([
    db.workspaceMembership.findMany({ where: { workspaceId: s.workspace.id }, include: { user: true }, orderBy: { createdAt: "asc" } }),
    db.featureFlag.findMany(),
    getUploadLimits(),
    uploadLimitsChange(),
    piiCodexEnabled(),
  ]);
  const ai = aiStatus();
  return (
    <section>
      <PageHeader title="Administration" subtitle={s.workspace.name} />
      <div className="grid g2">
        <div className="card">
          <div className="pad"><h2 className="card-h">Members and roles</h2></div>
          <div className="tablewrap"><table>
            <thead><tr><th scope="col">Member</th><th scope="col">Roles</th></tr></thead>
            <tbody>{members.map((m) => <tr key={m.id}><td>{m.user.displayName}<div className="meta">{m.user.jobTitle}</div></td><td>{csv(m.roles).map((r) => ROLE_LABELS[r as Role] ?? r).join(", ")}</td></tr>)}</tbody>
          </table></div>
        </div>
        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <div className="card pad">
            <div className="row between"><h2 className="card-h">AI provider</h2><TonePill tone={ai.ok ? "ok" : "warn"}>{ai.ok ? services.describe().label : "Needs configuration"}</TonePill></div>
            <dl className="dl">{ai.rows.map(([k, v]) => <div key={k} style={{ display: "contents" }}><dt>{k}</dt><dd style={{ wordBreak: "break-word" }}>{v}</dd></div>)}</dl>
            <TestConnectionButton />
            <p className="meta" style={{ marginBottom: 0 }}>Provider settings come from the deployment environment, never from this screen. Highly Confidential and Restricted content is never sent to an external model.</p>
          </div>
          <UploadLimitsForm limits={limits} ceilingMb={uploadCeilingMb()} canEdit={s.permissions.has("enterprise.manage")}
            changed={limitsChange ? `Last changed ${relativeTime(limitsChange.at)}${limitsChange.by ? ` by ${limitsChange.by}` : ""}.` : null} />
          <PiiCodexToggle enabled={piiCodex} canEdit={s.permissions.has("enterprise.manage")} />
          <div className="card pad">
            <h2 className="card-h">Feature flags</h2>
            <dl className="dl">{flags.map((f) => <div key={f.key} style={{ display: "contents" }}><dt>{f.key}</dt><dd>{f.enabled ? "On" : "Off"} · {f.description}</dd></div>)}</dl>
          </div>
          <div className="card pad">
            <h2 className="card-h">Policies</h2>
            <dl className="dl">{([["Default classification", "Internal"], ["Data region", s.workspace.region], ["Retention", "7 years after archive"], ["Review reminders", "30 days before due, escalate 14 days after"], ["Public portal", "Disabled"]] as [string, string][]).map(([k, v]) => <div key={k} style={{ display: "contents" }}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          </div>
        </div>
      </div>
    </section>
  );
}

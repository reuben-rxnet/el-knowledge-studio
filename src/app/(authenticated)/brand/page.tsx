import Link from "next/link";
import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { requirePageSession } from "@/lib/auth/session";
import { TonePill } from "@/components/common/badges";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";

export const metadata: Metadata = { title: "Brand Center" };

const ASSETS: [string, string, boolean][] = [
  ["Product mark", "Text placeholder in use. Waiting for an approved corporate asset.", false],
  ["Colour theme", "EL Enterprise · navy, action blue, cyan, gold", true],
  ["Typography", "Segoe UI Variable with Inter and Arial fallbacks", true],
  ["Intro and outro sequences", "Not uploaded yet", false],
  ["Watermarks", "Classification label watermark (generated)", true],
  ["Document header and footer", "SOP header with owner, version and review date", true],
  ["Disclaimer blocks", "AI-generated content disclaimer", true],
  ["Voice settings", "Approved stock voices only. Voice cloning disabled.", true],
];

export default async function BrandCenter() {
  const s = await requirePageSession();
  if (!s.permissions.has("brand.manage")) {
    return <section><div className="card"><EmptyState icon={Lock} title="Brand Center is for brand administrators" action={<Link className="btn" href="/">Back to Home</Link>}>It needs the brand.manage permission. In the demo, switch persona to Enterprise administrator.</EmptyState></div></section>;
  }
  return (
    <section>
      <PageHeader title="Brand Center" subtitle="Approved, versioned brand assets applied to every video and document." />
      <div className="grid g3">
        {ASSETS.map(([n, d, ok]) => <div key={n} className="card pad"><h2 className="card-h">{n}</h2><p className="meta" style={{ margin: "4px 0 10px" }}>{d}</p><TonePill tone={ok ? "ok" : "warn"}>{ok ? "Approved" : "Needs an approved asset"}</TonePill></div>)}
      </div>
      <p className="meta">Asset upload, versioning and approval are planned for phase 5.</p>
    </section>
  );
}

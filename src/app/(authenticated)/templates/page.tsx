import Link from "next/link";
import type { Metadata } from "next";
import { requirePageSession } from "@/lib/auth/session";
import { db } from "@/lib/database/client";
import { csv, OUTPUT_TYPES } from "@/lib/domain/constants";
import { PageHeader } from "@/components/common/page-header";

export const metadata: Metadata = { title: "Templates" };

export default async function TemplatesPage() {
  const s = await requirePageSession();
  const templates = await db.template.findMany({ orderBy: { name: "asc" } });
  const canCreate = s.permissions.has("project.create");
  return (
    <section>
      <PageHeader title="Templates" subtitle="Governed starting points with the right outputs, approval flow and branding built in." />
      <div className="grid g3">
        {templates.map((t, i) => (
          <div key={t.id} className="card tplcard">
            <div className="tplart" aria-hidden style={{ background: `linear-gradient(135deg,hsl(${200 + i * 9} 60% 24%),hsl(${190 + i * 9} 80% 44%))` }} />
            <div className="pad" style={{ display: "grid", gap: 4 }}>
              <h2 className="card-h">{t.name}</h2>
              <div className="meta">{t.businessFunction} · {csv(t.outputs).map((o) => OUTPUT_TYPES.find((x) => x.key === o)?.label ?? o).join(", ")}</div>
              <div className="meta">Approval: {t.approvalWorkflow}</div>
              {canCreate && <Link className="btn sm" style={{ justifySelf: "start", marginTop: 8 }} href={`/create/wizard?template=${t.key}`}>Use template</Link>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

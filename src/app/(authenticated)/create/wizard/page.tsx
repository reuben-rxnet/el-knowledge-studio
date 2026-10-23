import Link from "next/link";
import type { Metadata } from "next";
import { requirePageSession } from "@/lib/auth/session";
import { SOURCE_KINDS, TEMPLATES, type SourceKind } from "@/lib/domain/constants";
import { services } from "@/lib/services/registry";
import { PageHeader } from "@/components/common/page-header";
import { CreationWizard } from "@/components/content/creation-wizard";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "New project" };

export default async function WizardPage({ searchParams }: { searchParams: Promise<{ source?: string; template?: string }> }) {
  const s = await requirePageSession();
  if (!s.permissions.has("project.create")) redirect("/create");
  const { source, template } = await searchParams;
  const src = SOURCE_KINDS.some((k) => k.key === source) ? (source as SourceKind) : "recording";
  const tpl = TEMPLATES.some((t) => t.key === template) ? template : undefined;
  return (
    <section>
      <PageHeader eyebrow="Guided creation" title="New knowledge project" crumbs={[{ label: "Create", href: "/create" }, { label: "Guided wizard" }]} actions={<Link className="btn ghost" href="/create">Cancel</Link>} />
      <CreationWizard owner={s.user.displayName} initialSource={src} initialTemplate={tpl} aiLabel={services.describe().label} />
    </section>
  );
}

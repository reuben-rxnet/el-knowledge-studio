import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { services } from "@/lib/services/registry";
import { PageHeader } from "@/components/common/page-header";
import { Recorder } from "@/components/recording/recorder";

export const metadata: Metadata = { title: "Record a process" };

export default async function RecordPage() {
  const s = await requirePageSession();
  if (!s.permissions.has("recording.create")) redirect("/create");
  return (
    <section>
      <PageHeader eyebrow="Record a process" title="Before you record" crumbs={[{ label: "Create", href: "/create" }, { label: "Record" }]}
        subtitle="Show only what the audience needs. EL Knowledge Studio records the tab, window or screen you choose and nothing else." />
      <Recorder owner={s.user.displayName} workspace={s.workspace.name} aiLabel={services.describe().label} />
    </section>
  );
}

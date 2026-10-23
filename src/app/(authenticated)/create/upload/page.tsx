import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { services } from "@/lib/services/registry";
import { UPLOAD_RULES } from "@/lib/validation/schemas";
import { PageHeader } from "@/components/common/page-header";
import { UploadPanel } from "@/components/recording/upload-panel";

export const metadata: Metadata = { title: "Upload content" };

export default async function UploadPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const s = await requirePageSession();
  if (!s.permissions.has("project.create")) redirect("/create");
  const { kind } = await searchParams;
  return (
    <section>
      <PageHeader eyebrow="Upload content" title="Upload a video, audio file, document or presentation" crumbs={[{ label: "Create", href: "/create" }, { label: "Upload" }]}
        subtitle={kind === "meeting" ? "Only upload Teams recordings that every participant agreed to share for knowledge creation." : "Files are validated and checked for malware, then stored in your workspace's data region before processing."} />
      <UploadPanel owner={s.user.displayName} aiLabel={services.describe().label} maxBytes={UPLOAD_RULES.maxBytes} preferredKind={kind} />
    </section>
  );
}

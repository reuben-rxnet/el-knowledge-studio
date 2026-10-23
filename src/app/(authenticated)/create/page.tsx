import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Disc, FileText, LayoutTemplate, ShieldCheck, Video } from "lucide-react";
import { requirePageSession } from "@/lib/auth/session";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";

export const metadata: Metadata = { title: "Create" };

const CARDS = [
  { href: "/create/record", icon: Disc, title: "Record a process", body: "Capture a browser tab, window or screen while you narrate. We turn it into chapters, a guide and captions.", meta: "Your browser's screen-share picker · you choose what's shared" },
  { href: "/create/upload?kind=video", icon: Video, title: "Upload a video", body: "Bring an existing MP4, MOV or WEBM, such as a Teams recording you have consent to use.", meta: "MP4 · MOV · WEBM · MP3 · WAV" },
  { href: "/create/upload?kind=document", icon: FileText, title: "Import documents or slides", body: "Turn a PDF, DOCX or PPTX procedure into structured steps, an article and a quiz.", meta: "PDF · DOCX · PPTX · PNG · JPG" },
  { href: "/templates", icon: LayoutTemplate, title: "Start from a template", body: "Pick a governed template with the right outputs, approval flow and branding for your function.", meta: "10 enterprise templates" },
];

export default async function CreatePage() {
  const s = await requirePageSession();
  if (!s.permissions.has("project.create")) {
    return <section><div className="card"><EmptyState icon={ShieldCheck} title="Your role can't create content" action={<Link className="btn" href="/knowledge">Search the Knowledge Hub</Link>}>Creating needs the Creator role in {s.workspace.name}. Ask your workspace administrator for access.</EmptyState></div></section>;
  }
  return (
    <section>
      <PageHeader title="Create" subtitle="Choose how your knowledge starts. Every route produces AI drafts that stay drafts until a person reviews and approves them." />
      <div className="grid g2">
        {CARDS.map((c, i) => (
          <Link key={c.title} href={c.href} className="card createcard">
            <span className={`cc-art cc-${i}`} aria-hidden><c.icon size={26} /></span>
            <span className="cc-body"><span className="card-h">{c.title}</span><span style={{ fontSize: 14, color: "var(--text-2)" }}>{c.body}</span><span className="meta">{c.meta}</span></span>
            <ArrowRight size={18} aria-hidden />
          </Link>
        ))}
      </div>
      <div className="card pad row between">
        <div><div className="card-h">Not sure where to start?</div><div className="meta">The guided wizard walks you through source, outputs, context and template in five steps.</div></div>
        <Link className="btn primary" href="/create/wizard">Open guided wizard <ArrowRight size={16} aria-hidden /></Link>
      </div>
      <div className="card pad row" style={{ gap: 16 }}>
        <ShieldCheck size={20} aria-hidden />
        <div style={{ flex: 1, minWidth: 240 }}>
          <div className="card-h">What happens to your content</div>
          <div className="meta" style={{ fontSize: 13 }}>Sources are scanned and stored in your workspace&apos;s data region. AI drafts are labelled, sensitive information is flagged for redaction, and nothing is published without approval.</div>
        </div>
      </div>
    </section>
  );
}

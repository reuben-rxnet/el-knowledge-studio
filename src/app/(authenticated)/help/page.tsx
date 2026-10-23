import type { Metadata } from "next";
import { PageHeader } from "@/components/common/page-header";

export const metadata: Metadata = { title: "Help and Learning" };

const TOPICS: [string, string][] = [
  ["Recording policy", "Record only what your audience needs. Never show passwords, customer personal data or restricted information. Only the tab, window or screen you choose is captured, keystrokes are never logged, and you can pause or stop at any time."],
  ["How AI drafts work", "AI turns your narration and screen actions into a script, chapters, guide steps and an article. Every AI output is labelled, linked to a source timestamp and stays a draft until a person approves it."],
  ["Review and approval", "A subject-matter expert reviews the draft, then an approver signs off one specific version. Editing an approved version creates a new draft, and the approved version stays live."],
  ["Responsible AI", "No autonomous publishing, emotion inference, productivity scoring, facial recognition or voice cloning. Analytics are aggregated and describe content, not people."],
];

export default function HelpPage() {
  return (
    <section style={{ maxWidth: 900 }}>
      <PageHeader title="Help and Learning" subtitle="How EL Knowledge Studio works, and the rules that keep it trustworthy." />
      {TOPICS.map(([t, b]) => <article key={t} className="card pad"><h2 className="card-h">{t}</h2><p style={{ margin: "6px 0 0", maxWidth: "72ch" }}>{b}</p></article>)}
    </section>
  );
}

import type { Metadata } from "next";
import { PageHeader } from "@/components/common/page-header";

export const metadata: Metadata = { title: "Feedback" };

export default function FeedbackPage() {
  return (
    <section style={{ maxWidth: 900 }}>
      <PageHeader title="Feedback" subtitle="Tell the product team what works and what doesn't." />
      <div className="card pad" style={{ display: "grid", gap: 8 }}>
        <p style={{ margin: 0 }}>During the pilot, send feedback through the EL Knowledge Studio channel in Microsoft Teams.</p>
        <p className="meta" style={{ margin: 0 }}>An in-app feedback form with an email and Teams notification connector is planned. It isn&apos;t enabled in this build, so there&apos;s no form here that would look like it sends something.</p>
      </div>
    </section>
  );
}

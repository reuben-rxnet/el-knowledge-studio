"use client";
import { useTransition } from "react";
import { CheckCircle2 } from "lucide-react";
import { setOfficialRender } from "@/server/actions/publishing-video";
import { useToast } from "@/components/common/toast";

/** "Use for publishing" on a finished render; once chosen it reads "Chosen for publishing" (click again to clear). */
export function OfficialRenderButton({ projectId, renderId, official, onChanged }: { projectId: string; renderId: string; official: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <button type="button" className={`btn sm${official ? " primary" : ""}`} disabled={pending} aria-pressed={official} data-testid="use-for-publishing"
      title={official ? "This video is published with the version. Click to clear the choice." : "Publish this video with the version"}
      onClick={() => start(async () => {
        const r = await setOfficialRender({ projectId, renderId, use: !official });
        if (!r.ok) { toast(r.error.message); return; }
        toast(r.data.renderId ? `This video will be published with version ${r.data.version}.` : `No video is chosen for version ${r.data.version} now.`);
        onChanged();
      })}>
      {official ? <><CheckCircle2 size={14} aria-hidden /> Chosen for publishing</> : "Use for publishing"}
    </button>
  );
}

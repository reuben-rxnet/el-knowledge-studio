"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { savePiiCodex } from "@/server/actions/admin";
import { useToast } from "@/components/common/toast";

/** Whether Studio's personal-data detection may ask Codex about the text it reads from the screen. */
export function PiiCodexToggle({ enabled, canEdit }: { enabled: boolean; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [on, setOn] = useState(enabled);
  const [pending, start] = useTransition();
  return (
    <div className="card pad" data-testid="pii-codex">
      <h2 className="card-h">Personal data in Studio</h2>
      <p className="meta" style={{ marginTop: 0 }}>Studio reads the text on screen on this server and blurs email addresses, phone numbers and the names of people in the workspace. Codex can also find other names, addresses and IDs; it then receives the text read from the screen (never the picture), within the classification rules.</p>
      <label className="check">
        <input type="checkbox" checked={on} disabled={!canEdit || pending} onChange={(e) => {
          const v = e.target.checked;
          setOn(v);
          start(async () => {
            const r = await savePiiCodex(v);
            if (!r.ok) { setOn(!v); toast(r.error.message); return; }
            toast(v ? "Codex check switched on." : "Codex check switched off.");
            router.refresh();
          });
        }} />
        <span>Also ask Codex<small>{canEdit ? "Off by default. Confirm your AI data-processing approval covers screen text first." : "Only platform administrators can change this."}</small></span>
      </label>
    </div>
  );
}

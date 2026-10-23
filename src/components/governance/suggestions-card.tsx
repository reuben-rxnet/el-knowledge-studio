"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { applySuggestion } from "@/server/actions/quality";
import { useToast } from "@/components/common/toast";

type Field = "title" | "businessFunction" | "audience" | "classification";
interface Row { field: Field; label: string; current: string; suggested: string; reason?: string }

/** AI suggestions are never applied automatically: the owner applies each one, and it is audited. */
export function SuggestionsCard({ projectId, rows, canEdit }: { projectId: string; rows: Row[]; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const differing = rows.filter((r) => r.current.trim() !== r.suggested.trim());
  if (!differing.length) return null;
  return (
    <div className="card pad">
      <div className="row between"><h2 className="card-h"><Sparkles size={16} aria-hidden /> AI suggestions</h2><span className="ai-label">Not applied until you choose</span></div>
      <div className="tablewrap" style={{ marginTop: 8 }}>
        <table>
          <thead><tr><th scope="col">Field</th><th scope="col">Now</th><th scope="col">Suggested</th><th scope="col"><span className="sr">Action</span></th></tr></thead>
          <tbody>
            {differing.map((r) => (
              <tr key={r.field}>
                <td className="meta">{r.label}</td>
                <td>{r.current}</td>
                <td><b>{r.suggested}</b>{r.reason && <div className="meta">{r.reason}</div>}</td>
                <td>{canEdit && <button className="btn sm" disabled={pending} onClick={() => start(async () => { const res = await applySuggestion({ projectId, field: r.field }); if (!res.ok) { setErr(res.error.message); return; } setErr(null); toast(`${r.label} updated.`); router.refresh(); })}>Apply</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {err && <span className="field-error" role="alert">{err}</span>}
    </div>
  );
}

"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveUploadLimits } from "@/server/actions/admin";
import { CATEGORY_META, UPLOAD_CATEGORIES, formatLimit, type UploadCategory, type UploadLimits } from "@/lib/validation/upload-limits";
import { useToast } from "@/components/common/toast";

/** Upload size limit per file type. Platform administrators edit it; everyone else sees the values. */
export function UploadLimitsForm({ limits, ceilingMb, canEdit, changed }: { limits: UploadLimits; ceilingMb: number; canEdit: boolean; changed: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [v, setV] = useState<Record<UploadCategory, string>>(() => Object.fromEntries(UPLOAD_CATEGORIES.map((c) => [c, String(limits[c])])) as Record<UploadCategory, string>);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const dirty = UPLOAD_CATEGORIES.some((c) => Number(v[c]) !== limits[c]);

  function save() {
    start(async () => {
      const r = await saveUploadLimits(Object.fromEntries(UPLOAD_CATEGORIES.map((c) => [c, Number(v[c])])));
      if (!r.ok) { setErrors(r.fieldErrors ?? { _: r.error.message }); return; }
      setErrors({});
      toast("Upload limits saved. They apply to the next upload.");
      router.refresh();
    });
  }

  return (
    <div className="card pad" data-testid="upload-limits">
      <h2 className="card-h">Upload limits</h2>
      <p className="meta" style={{ marginTop: 0 }}>Largest file people can upload, per type. The ceiling for this environment is {formatLimit(ceilingMb)}, set by IT.</p>
      <div className="tablewrap"><table>
        <thead><tr><th scope="col">Type</th><th scope="col">Limit (MB)</th></tr></thead>
        <tbody>{UPLOAD_CATEGORIES.map((c) => (
          <tr key={c}>
            <th scope="row">{CATEGORY_META[c].label}<div className="meta">{CATEGORY_META[c].types}</div></th>
            <td>{canEdit ? (
              <label className="row" style={{ gap: 6 }}>
                <span className="sr">{CATEGORY_META[c].label} limit in megabytes</span>
                <input type="number" min={1} max={ceilingMb} step={1} style={{ width: 110 }} value={v[c]} aria-invalid={!!errors[c]} aria-describedby={errors[c] ? `err-${c}` : undefined}
                  onChange={(e) => setV((x) => ({ ...x, [c]: e.target.value }))} />
                <span className="meta">{Number(v[c]) >= 1 ? formatLimit(Number(v[c])) : ""}</span>
              </label>
            ) : formatLimit(limits[c])}
              {errors[c] && <div className="meta" id={`err-${c}`} style={{ color: "var(--error)" }}>{errors[c]}</div>}
            </td>
          </tr>
        ))}</tbody>
      </table></div>
      {errors._ && <div className="callout warn" role="alert" style={{ marginTop: 8 }}><b>{errors._}</b></div>}
      {canEdit
        ? <button className="btn primary" style={{ marginTop: 10 }} disabled={!dirty || pending} onClick={save} data-testid="save-upload-limits">{pending ? "Saving…" : "Save limits"}</button>
        : <p className="meta" style={{ marginBottom: 0 }}>Only platform administrators can change these.</p>}
      <p className="meta" style={{ marginBottom: 0 }}>{changed ?? "Default values. Changes are recorded in the audit history."}</p>
    </div>
  );
}

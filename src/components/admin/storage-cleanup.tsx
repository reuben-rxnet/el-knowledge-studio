"use client";
import { useState, useTransition } from "react";
import { deleteUnusedFiles, findUnusedFiles, type UnusedFiles } from "@/server/actions/admin";
import { useToast } from "@/components/common/toast";
import { formatDate } from "@/lib/utilities/format";

const size = (b: number) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Finds stored files nothing refers to any more (abandoned uploads, replaced recordings) and deletes them. */
export function StorageCleanup({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const [found, setFound] = useState<UnusedFiles | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const find = () => start(async () => {
    const r = await findUnusedFiles();
    if (!r.ok) { setError(r.error.message); return; }
    setError(null); setFound(r.data);
  });
  const remove = () => start(async () => {
    if (!found || !window.confirm(`Delete ${found.count} unused file${found.count === 1 ? "" : "s"}? This can't be undone.`)) return;
    const r = await deleteUnusedFiles();
    if (!r.ok) { setError(r.error.message); return; }
    toast(`Deleted ${r.data.deleted} unused file${r.data.deleted === 1 ? "" : "s"} (${size(r.data.bytes)})${r.data.failed ? `; ${r.data.failed} couldn't be deleted` : ""}.`);
    const again = await findUnusedFiles();
    setFound(again.ok ? again.data : null);
  });

  return (
    <div className="card pad" data-testid="storage-cleanup">
      <h2 className="card-h">Storage clean-up</h2>
      <p className="meta" style={{ marginTop: 0 }}>Finds stored files that no project, render, screenshot or music track refers to, such as uploads from a wizard that was never finished. Files changed in the last 24 hours are always kept.</p>
      {found && (
        <p style={{ margin: "0 0 10px" }} data-testid="cleanup-result" aria-live="polite">
          {found.count ? <><b>{found.count} unused file{found.count === 1 ? "" : "s"}</b> · {size(found.totalBytes)}{found.oldest ? ` · oldest from ${formatDate(new Date(found.oldest))}` : ""}</> : "No unused files."}
        </p>
      )}
      {error && <div className="callout warn" role="alert" style={{ marginBottom: 10 }}><b>{error}</b></div>}
      {canEdit ? (
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" disabled={pending} onClick={find} data-testid="cleanup-find">{pending && !found ? "Looking…" : "Find unused files"}</button>
          {found && found.count > 0 && <button className="btn primary" disabled={pending} onClick={remove} data-testid="cleanup-delete">{pending ? "Deleting…" : `Delete ${found.count} unused file${found.count === 1 ? "" : "s"}`}</button>}
        </div>
      ) : <p className="meta" style={{ margin: 0 }}>Only platform administrators can do this.</p>}
    </div>
  );
}

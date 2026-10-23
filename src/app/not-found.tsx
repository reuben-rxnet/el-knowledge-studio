import Link from "next/link";

export default function NotFound() {
  return (
    <main className="content" id="content" style={{ display: "grid", placeItems: "center", minHeight: "100%" }}>
      <div className="card pad" style={{ maxWidth: 520, textAlign: "center", display: "grid", gap: 10 }}>
        <h1 className="page-title">This page or project isn&apos;t available</h1>
        <p className="page-sub" style={{ margin: 0 }}>It may have been archived or deleted, or it belongs to a workspace you&apos;re not a member of. Switch workspace or search the library.</p>
        <div className="row" style={{ justifyContent: "center" }}><Link className="btn primary" href="/projects">Open Team Library</Link><Link className="btn" href="/">Home</Link></div>
      </div>
    </main>
  );
}

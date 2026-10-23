"use client";
import Link from "next/link";

/** Error boundary: explains what happened and offers recovery. Never shows stack traces. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  return (
    <section>
      <div className="card pad" style={{ maxWidth: 640, display: "grid", gap: 10 }}>
        <h1 className="page-title">{offline ? "You're offline" : "This page couldn't load"}</h1>
        <p className="page-sub" style={{ margin: 0 }}>
          {offline ? "Check your network or VPN connection. Your saved work is safe." : "The server couldn't complete the request. Your saved work is safe. Try again, and if it keeps happening, quote the reference below to support."}
        </p>
        {error.digest && <p className="meta" style={{ margin: 0 }}>Reference: <code>{error.digest}</code></p>}
        <div className="row"><button className="btn primary" onClick={reset}>Try again</button><Link className="btn" href="/">Back to Home</Link></div>
      </div>
    </section>
  );
}

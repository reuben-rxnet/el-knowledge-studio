"use client";
import { useState, useTransition } from "react";
import { PlugZap } from "lucide-react";
import { testAiConnection, type ConnectionResult } from "@/server/actions/admin";

export function TestConnectionButton() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ConnectionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
      <button className="btn" style={{ justifySelf: "start" }} disabled={pending} data-testid="test-ai"
        onClick={() => start(async () => { const r = await testAiConnection(); if (r.ok) { setResult(r.data); setError(null); } else setError(r.error.message); })}>
        <PlugZap size={16} aria-hidden /> {pending ? "Testing…" : "Test connection"}
      </button>
      <div aria-live="polite">
        {result && <div className={`callout ${result.ok ? "tip" : "warn"}`}><b>{result.ok ? "Connected." : `Failed${result.code ? ` (${result.code})` : ""}.`}</b>&nbsp;{result.message}{result.model ? ` Served model: ${result.model}.` : ""}</div>}
        {error && <div className="callout warn" role="alert"><b>{error}</b></div>}
      </div>
    </div>
  );
}

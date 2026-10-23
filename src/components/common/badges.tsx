import { Lock, Sparkles } from "lucide-react";
import { FRESHNESS_META, STATUS_META, type FreshnessStatus, type ProjectStatus, type Tone } from "@/lib/domain/constants";

/** Status is always shown with text plus colour — never colour alone. */
export function TonePill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={`pill s-${tone}`}>{children}</span>;
}

export function StatusPill({ status }: { status: string }) {
  const meta = STATUS_META[status as ProjectStatus] ?? { label: status, tone: "neutral" as Tone };
  return <TonePill tone={meta.tone}>{meta.label}</TonePill>;
}

export function FreshnessPill({ status }: { status: FreshnessStatus }) {
  const m = FRESHNESS_META[status];
  return <TonePill tone={m.tone}>{m.label}</TonePill>;
}

export function ClassificationTag({ value }: { value: string }) {
  const cls = value === "Confidential" ? "c-conf" : value === "Highly Confidential" || value === "Restricted" ? "c-hc" : "";
  return (
    <span className={`cls ${cls}`} title={`Classification: ${value}`}>
      <Lock size={11} aria-hidden /> {value}
    </span>
  );
}

export function AiLabel({ children = "AI generated" }: { children?: React.ReactNode }) {
  return (
    <span className="ai-label">
      <Sparkles size={12} aria-hidden /> {children}
    </span>
  );
}

export function MockLabel({ children = "Simulated" }: { children?: React.ReactNode }) {
  return <span className="mock-label">{children}</span>;
}

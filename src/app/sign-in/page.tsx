import type { Metadata } from "next";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { db } from "@/lib/database/client";
import { DEMO_PERSONAS, isDemoAuthEnabled } from "@/lib/auth/demo";
import { signInAsPersona } from "@/server/actions/auth";
import { isEntraEnabled } from "@/lib/auth/entra-config";
import { AppFooter, EssilorLuxotticaLogo } from "@/components/common/brand";
import { ROLE_LABELS, type Role } from "@/lib/permissions";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

const SIGN_IN_ERRORS: Record<string, string> = {
  "no-access": "Your account has no EL Knowledge Studio role yet. Ask your workspace administrator or IT to assign one in Entra ID.",
  "wrong-tenant": "That account belongs to another organization. Sign in with your EssilorLuxottica account.",
  "group-overage": "Your account is in too many groups to read at sign-in. IT needs to send only the groups assigned to this application.",
  expired: "The sign-in took too long or was opened in another tab. Start again.",
  "entra-unavailable": "Microsoft sign-in can't be reached right now. Try again in a few minutes.",
  "too-many-attempts": "Too many sign-in attempts from this network. Wait a few minutes, then try again.",
  "signin-failed": "Microsoft sign-in didn't complete. Try again; if it keeps happening, contact the service desk.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next = "/", error } = await searchParams;
  const demo = isDemoAuthEnabled();
  const users = demo ? await db.user.findMany({ where: { email: { in: DEMO_PERSONAS.map((p) => p.email) } }, include: { memberships: { include: { workspace: true } } } }) : [];

  return (
    <main className="signin">
      <section className="signin-hero" aria-labelledby="brand">
        <div style={{ display: "grid", gap: 6 }}>
          <div className="mark" style={{ padding: 0 }}><span className="lens" aria-hidden /><b>EL</b><span>| Knowledge Studio</span></div>
          <div className="endorse" style={{ padding: 0 }}><span>by</span><EssilorLuxotticaLogo className="endorse-logo" /></div>
        </div>
        <div>
          <p className="tag">Capture once. Share knowledge everywhere.</p>
          <h1 id="brand">Turn everyday expertise into enterprise knowledge</h1>
          <p className="lead">Transform business processes into videos, guides, training content and searchable knowledge with enterprise AI.</p>
        </div>
        <p className="meta" style={{ color: "#9fb3cc" }}>Fictional demo data · internal prototype</p>
      </section>

      <section className="signin-panel" aria-labelledby="signin-h">
        <h2 id="signin-h" className="page-title">Sign in</h2>
        {demo ? (
          <>
            <div className="callout warn" role="note"><b>Demo authentication.</b>&nbsp;Local development only. Production uses Microsoft Entra ID single sign-on, and this screen can&apos;t be enabled in production builds.</div>
            {error && <div className="callout warn" role="alert"><b>That persona isn&apos;t available.</b>&nbsp;Run <code>npm run db:seed</code> and try again.</div>}
            <ul className="persona-grid">
              {DEMO_PERSONAS.map((p) => {
                const u = users.find((x) => x.email === p.email);
                if (!u) return null;
                const roles = [...new Set(u.memberships.flatMap((m) => m.roles.split(",")))].map((r) => ROLE_LABELS[r as Role] ?? r);
                return (
                  <li key={p.email}>
                    <form action={signInAsPersona}>
                      <input type="hidden" name="email" value={p.email} />
                      <input type="hidden" name="next" value={next} />
                      <button className="persona-card" type="submit" data-testid={`persona-${p.persona.split(" ")[0]!.toLowerCase()}`}>
                        <span className="avatar">{u.initials}</span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span className="t" style={{ display: "block" }}>{u.displayName}</span>
                          <span className="meta" style={{ display: "block" }}>{p.persona} · {p.blurb}</span>
                          <span className="meta" style={{ display: "block" }}>{u.memberships.length} workspace{u.memberships.length === 1 ? "" : "s"} · {roles.join(", ")}</span>
                        </span>
                        <ArrowRight size={16} aria-hidden />
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <div className="card pad" style={{ display: "grid", gap: 12 }}>
            <p style={{ margin: 0 }}><ShieldCheck size={18} aria-hidden /> Sign in with your EssilorLuxottica account.</p>
            {error && <div className="callout warn" role="alert"><b>{SIGN_IN_ERRORS[error] ?? "Sign-in didn't complete. Try again."}</b></div>}
            {isEntraEnabled()
              ? <a className="btn primary" style={{ justifySelf: "start" }} href={`/api/auth/login?next=${encodeURIComponent(next)}`} data-testid="entra-signin">Sign in with Microsoft</a>
              : <p className="meta" style={{ margin: 0 }}>Company sign-in (Microsoft Entra ID) isn&apos;t configured in this environment yet. See docs/iam-registration.md.</p>}
          </div>
        )}
        <div className="spacer" />
        <AppFooter />
      </section>
    </main>
  );
}

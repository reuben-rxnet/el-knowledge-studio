"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/database/client";
import { isDemoAuthEnabled, SESSION_COOKIE, WORKSPACE_COOKIE } from "@/lib/auth/demo";
import { requireSession } from "@/lib/auth/session";
import { isEntraEnabled, loadEntraConfig } from "@/lib/auth/entra-config";
import { SESSION_HOURS, signSession } from "@/lib/auth/session-cookie";

const cookieOpts = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 8 };

/** Demo sign-in: development only. Refused in production builds regardless of configuration. */
export async function signInAsPersona(formData: FormData) {
  if (!isDemoAuthEnabled()) throw new Error("Demo sign-in is disabled in this environment.");
  const email = String(formData.get("email") ?? "");
  const user = await db.user.findUnique({ where: { email }, include: { memberships: true } });
  if (!user || !user.memberships.length) redirect("/sign-in?error=unknown");
  const jar = await cookies();
  jar.set(SESSION_COOKIE, signSession({ uid: user.id, via: "demo", exp: Date.now() + SESSION_HOURS * 3_600_000 }), cookieOpts);
  jar.set(WORKSPACE_COOKIE, user.memberships[0]!.workspaceId, cookieOpts);
  const next = String(formData.get("next") ?? "/");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function signOut() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(WORKSPACE_COOKIE);
  // Company sign-in: also end the Microsoft session, then come back to the sign-in page.
  if (isEntraEnabled()) {
    const cfg = loadEntraConfig();
    // The test identity provider (ENTRA_ISSUER_OVERRIDE, non-production only) has its own end-session URL.
    const override = process.env.NODE_ENV !== "production" ? process.env.ENTRA_ISSUER_OVERRIDE?.trim() : undefined;
    const back = encodeURIComponent(`${cfg.baseUrl}/sign-in`);
    redirect(override ? `${override.replace(/\/+$/, "")}/session/end?post_logout_redirect_uri=${back}&client_id=${cfg.clientId}` : `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/logout?post_logout_redirect_uri=${back}`);
  }
  redirect("/sign-in");
}

/** Workspace switch: the target must be one of the user's memberships (no IDOR via cookie). */
export async function switchWorkspace(formData: FormData) {
  const session = await requireSession();
  const id = String(formData.get("workspaceId") ?? "");
  if (!session.workspaces.some((w) => w.id === id)) throw new Error("You are not a member of that workspace.");
  (await cookies()).set(WORKSPACE_COOKIE, id, cookieOpts);
  redirect("/");
}

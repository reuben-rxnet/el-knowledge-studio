import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import * as oidc from "openid-client";
import { db } from "@/lib/database/client";
import { SESSION_COOKIE, WORKSPACE_COOKIE } from "@/lib/auth/demo";
import { isEntraEnabled } from "@/lib/auth/entra-config";
import { entra, identityFrom, provisionUser } from "@/lib/auth/entra";
import { SESSION_HOURS, sessionSecret, signSession } from "@/lib/auth/session-cookie";

export const dynamic = "force-dynamic";
const OIDC_COOKIE = "elks_oidc";

function readOidcCookie(raw: string | undefined) {
  if (!raw) return null;
  const [body, sig] = raw.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", sessionSecret()).update(`oidc.${body}`).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const v = JSON.parse(Buffer.from(body, "base64url").toString()) as { v: string; s: string; n: string; next: string; exp: number };
  return v.exp > Date.now() ? v : null;
}

/** Entra ID redirect target: verifies the code (PKCE, state, nonce, ID token), provisions the user, signs a session. */
export async function GET(req: Request) {
  const fail = (code: string) => {
    const res = NextResponse.redirect(new URL(`/sign-in?error=${code}`, req.url));
    res.cookies.delete({ name: OIDC_COOKIE, path: "/api/auth" });
    return res;
  };
  if (!isEntraEnabled()) return fail("entra-off");
  const pending = readOidcCookie(req.headers.get("cookie")?.match(new RegExp(`${OIDC_COOKIE}=([^;]+)`))?.[1]);
  if (!pending) return fail("expired");
  try {
    const { cfg, server } = entra();
    const config = await server;
    // Rebuild the URL from the configured public base (the app may sit behind a proxy).
    const incoming = new URL(req.url);
    const current = new URL(`${cfg.redirectUri}${incoming.search}`);
    const tokens = await oidc.authorizationCodeGrant(config, current, { pkceCodeVerifier: pending.v, expectedState: pending.s, expectedNonce: pending.n, idTokenExpected: true });
    const claims = tokens.claims();
    if (!claims) return fail("no-id-token");
    const identity = identityFrom(claims as Record<string, unknown>, cfg);
    const user = await provisionUser(identity, cfg);
    if (!user) return fail("no-access");
    const membership = await db.workspaceMembership.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
    await db.auditEvent.create({ data: { actorId: user.id, actorName: user.displayName, action: "auth.signed-in", resourceType: "user", resourceId: user.id, resourceLabel: "Entra ID sign-in", workspaceId: membership?.workspaceId ?? "", outcome: "success", correlationId: randomUUID() } });
    const res = NextResponse.redirect(new URL(pending.next, cfg.baseUrl));
    const opts = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_HOURS * 3600 };
    res.cookies.set(SESSION_COOKIE, signSession({ uid: user.id, via: "entra", exp: Date.now() + SESSION_HOURS * 3_600_000 }), opts);
    if (membership) res.cookies.set(WORKSPACE_COOKIE, membership.workspaceId, opts);
    res.cookies.delete({ name: OIDC_COOKIE, path: "/api/auth" });
    return res;
  } catch (e) {
    // The provider's or library's message is not shown; only a code.
    const code = e instanceof Error && /another organization/.test(e.message) ? "wrong-tenant" : e instanceof Error && /too many groups/.test(e.message) ? "group-overage" : "signin-failed";
    return fail(code);
  }
}

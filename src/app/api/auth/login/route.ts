import { NextResponse } from "next/server";
import * as oidc from "openid-client";
import { isEntraEnabled } from "@/lib/auth/entra-config";
import { entra } from "@/lib/auth/entra";
import { sessionSecret } from "@/lib/auth/session-cookie";
import { createHmac } from "node:crypto";

export const dynamic = "force-dynamic";
const OIDC_COOKIE = "elks_oidc";

/** Starts Entra ID sign-in: PKCE verifier, state and nonce go in a signed, 10-minute, httpOnly cookie. */
export async function GET(req: Request) {
  if (!isEntraEnabled()) return NextResponse.redirect(new URL("/sign-in", req.url));
  try {
    const { cfg, server } = entra();
    const config = await server;
    const next = new URL(req.url).searchParams.get("next") ?? "/";
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: cfg.redirectUri, scope: "openid profile email", response_type: "code",
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: "S256", state, nonce,
    });
    const body = Buffer.from(JSON.stringify({ v: verifier, s: state, n: nonce, next: next.startsWith("/") && !next.startsWith("//") ? next : "/", exp: Date.now() + 600_000 })).toString("base64url");
    const sig = createHmac("sha256", sessionSecret()).update(`oidc.${body}`).digest("base64url");
    const res = NextResponse.redirect(url);
    res.cookies.set(OIDC_COOKIE, `${body}.${sig}`, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/auth", maxAge: 600 });
    return res;
  } catch {
    return NextResponse.redirect(new URL("/sign-in?error=entra-unavailable", req.url));
  }
}

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed, expiring session tokens (HMAC-SHA256). The cookie carries only the user id, how they
 * signed in and when it expires; it is httpOnly, so scripts can't read it, and the signature means
 * it can't be forged or edited. SESSION_SECRET is required in production (32+ characters,
 * from Key Vault).
 */
export interface SessionToken { uid: string; via: "demo" | "entra"; exp: number }

const DEV_SECRET = "el-knowledge-studio-local-development-only-secret";

export function sessionSecret(env: Record<string, string | undefined> = process.env): string {
  const s = env.SESSION_SECRET?.trim();
  if (s && s.length >= 32) return s;
  if (env.NODE_ENV === "production") throw new Error("SESSION_SECRET (32+ characters) is required in production.");
  return DEV_SECRET;
}

const b64 = (b: Buffer) => b.toString("base64url");
const mac = (data: string, secret: string) => createHmac("sha256", secret).update(data).digest();

export function signSession(t: SessionToken, secret = sessionSecret()): string {
  const body = b64(Buffer.from(JSON.stringify(t)));
  return `${body}.${b64(mac(body, secret))}`;
}

export function verifySession(token: string | undefined, secret = sessionSecret(), now = Date.now()): SessionToken | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = mac(body, secret);
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const t = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionToken;
    if (typeof t.uid !== "string" || typeof t.exp !== "number" || t.exp < now) return null;
    if (t.via !== "demo" && t.via !== "entra") return null;
    return t;
  } catch {
    return null;
  }
}

export const SESSION_HOURS = 8;

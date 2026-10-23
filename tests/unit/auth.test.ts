import { describe, expect, it } from "vitest";
import { sessionSecret, signSession, verifySession } from "@/lib/auth/session-cookie";
import { loadEntraConfig, mergeGrants, rolesFromAppRoles, rolesFromGroups } from "@/lib/auth/entra-config";

const SECRET = "unit-test-secret-0123456789abcdef-0123";

describe("signed session cookies", () => {
  const token = { uid: "cm123", via: "entra" as const, exp: Date.now() + 60_000 };
  it("round-trips a valid token", () => expect(verifySession(signSession(token, SECRET), SECRET)).toEqual(token));
  it("rejects a raw user id (the old unsigned cookie)", () => expect(verifySession("cm123", SECRET)).toBeNull());
  it("rejects a tampered payload", () => {
    const [, sig] = signSession(token, SECRET).split(".");
    const forged = Buffer.from(JSON.stringify({ ...token, uid: "cm-admin" })).toString("base64url");
    expect(verifySession(`${forged}.${sig}`, SECRET)).toBeNull();
  });
  it("rejects another secret and expired tokens", () => {
    expect(verifySession(signSession(token, SECRET), "another-secret-0123456789abcdef-xyz")).toBeNull();
    expect(verifySession(signSession({ ...token, exp: Date.now() - 1 }, SECRET), SECRET)).toBeNull();
  });
  it("requires a real secret in production", () => {
    expect(() => sessionSecret({ NODE_ENV: "production" })).toThrow(/SESSION_SECRET/);
    expect(() => sessionSecret({ NODE_ENV: "production", SESSION_SECRET: "short" })).toThrow();
    expect(sessionSecret({ NODE_ENV: "production", SESSION_SECRET: SECRET })).toBe(SECRET);
  });
});

describe("Entra ID access mapping", () => {
  it("maps app roles '<workspace>.<role>' and enterprise-admin; ignores unknown values", () => {
    const r = rolesFromAppRoles(["retail-europe.creator", "retail-europe.reviewer", "operations.sme", "enterprise-admin", "retail-europe.superuser", "Admin", "../x.creator"]);
    expect(r.enterpriseAdmin).toBe(true);
    expect([...r.grants.get("retail-europe")!]).toEqual(["creator", "reviewer"]);
    expect([...r.grants.get("operations")!]).toEqual(["sme"]);
    expect(r.grants.size).toBe(2);
  });
  it("maps only configured groups, and merges with app roles", () => {
    const groups = rolesFromGroups(["g-1", "g-unknown"], { "g-1": { workspace: "retail-europe", roles: ["approver"] } });
    const merged = mergeGrants(groups, rolesFromAppRoles(["retail-europe.creator"]).grants);
    expect([...merged.get("retail-europe")!].sort()).toEqual(["approver", "creator"]);
  });
  it("validates the configuration", () => {
    const base = { ENTRA_TENANT_ID: "11111111-2222-3333-4444-555555555555", ENTRA_CLIENT_ID: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", ENTRA_CLIENT_SECRET: "a-client-secret", APP_BASE_URL: "https://ks.example.com/" };
    const c = loadEntraConfig(base);
    expect(c.redirectUri).toBe("https://ks.example.com/api/auth/callback");
    expect(c.issuer).toBe("https://login.microsoftonline.com/11111111-2222-3333-4444-555555555555/v2.0");
    expect(() => loadEntraConfig({ ...base, ENTRA_TENANT_ID: "not-a-guid" })).toThrow();
    expect(() => loadEntraConfig({ ...base, APP_BASE_URL: "http://ks.example.com", NODE_ENV: "production" })).toThrow(/https/);
    expect(() => loadEntraConfig({ ...base, ENTRA_GROUP_ROLE_MAP: JSON.stringify({ g: { workspace: "w", roles: ["owner"] } }) })).toThrow();
  });
});

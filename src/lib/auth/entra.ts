import "server-only";
import * as oidc from "openid-client";
import { db } from "@/lib/database/client";
import { loadEntraConfig, mergeGrants, rolesFromAppRoles, rolesFromGroups, type EntraConfig } from "./entra-config";

let cached: { cfg: EntraConfig; server: Promise<oidc.Configuration> } | null = null;

/**
 * OIDC client for Microsoft Entra ID, discovered from the tenant's v2.0 metadata.
 * ENTRA_ISSUER_OVERRIDE points at a local test identity provider for automated tests only;
 * it is ignored in production builds.
 */
export function entra() {
  if (!cached) {
    const cfg = loadEntraConfig();
    const override = process.env.NODE_ENV !== "production" ? process.env.ENTRA_ISSUER_OVERRIDE?.trim() : undefined;
    const issuer = new URL(override || cfg.issuer);
    const server = oidc.discovery(issuer, cfg.clientId, cfg.clientSecret, undefined, issuer.protocol === "http:" ? { execute: [oidc.allowInsecureRequests] } : undefined);
    cached = { cfg: override ? { ...cfg, issuer: issuer.href.replace(/\/$/, "") } : cfg, server };
    server.catch(() => { cached = null; });
  }
  return cached;
}

export interface EntraIdentity { oid: string; tid: string; email: string; name: string; groups: string[]; appRoles: string[] }

/** Reads the verified ID token claims we rely on. Refuses tokens from another tenant. */
export function identityFrom(claims: Record<string, unknown>, cfg: EntraConfig): EntraIdentity {
  const str = (k: string) => (typeof claims[k] === "string" ? (claims[k] as string) : "");
  const tid = str("tid");
  if (tid !== cfg.tenantId) throw new Error("This account belongs to another organization.");
  if (claims["_claim_names"] && !Array.isArray(claims["groups"])) {
    throw new Error("Your account is in too many groups to read from the sign-in token. Ask IT to emit only groups assigned to the application (groupMembershipClaims = ApplicationGroup).");
  }
  const oid = str("oid") || str("sub");
  const email = (str("email") || str("preferred_username")).toLowerCase();
  if (!oid || !email) throw new Error("The sign-in token is missing the account's id or email.");
  return { oid, tid, email, name: str("name") || email, groups: Array.isArray(claims["groups"]) ? (claims["groups"] as unknown[]).filter((g): g is string => typeof g === "string") : [], appRoles: Array.isArray(claims["roles"]) ? (claims["roles"] as unknown[]).filter((r): r is string => typeof r === "string") : [] };
}

/**
 * Creates or updates the user and SYNCS workspace memberships to the user's current Entra groups:
 * a role removed in Entra is removed here at the next sign-in. Returns null when no group grants access.
 */
export async function provisionUser(id: EntraIdentity, cfg: EntraConfig) {
  // Access comes from Entra app roles and/or mapped security groups, nothing else.
  const fromRoles = rolesFromAppRoles(id.appRoles);
  const grants = mergeGrants(rolesFromGroups(id.groups, cfg.groupRoleMap), fromRoles.grants);
  const enterpriseAdmin = fromRoles.enterpriseAdmin || (!!cfg.enterpriseAdminGroup && id.groups.includes(cfg.enterpriseAdminGroup));
  const workspaces = await db.workspace.findMany({ where: { slug: { in: [...grants.keys()] } } });
  if (!workspaces.length && !enterpriseAdmin) return null;
  const initials = id.name.split(/\s+/).filter(Boolean).map((w) => w[0]!.toUpperCase()).slice(0, 2).join("") || "?";
  const existing = await db.user.findFirst({ where: { OR: [{ externalId: id.oid }, { email: id.email }] } });
  const user = existing
    ? await db.user.update({ where: { id: existing.id }, data: { externalId: id.oid, email: id.email, displayName: id.name, initials, isEnterpriseAdmin: enterpriseAdmin, lastSignInAt: new Date() } })
    : await db.user.create({ data: { externalId: id.oid, email: id.email, displayName: id.name, initials, jobTitle: "", location: "", isEnterpriseAdmin: enterpriseAdmin, lastSignInAt: new Date() } });
  await db.$transaction([
    db.workspaceMembership.deleteMany({ where: { userId: user.id, workspaceId: { notIn: workspaces.map((w) => w.id) } } }),
    ...workspaces.map((w) => db.workspaceMembership.upsert({
      where: { userId_workspaceId: { userId: user.id, workspaceId: w.id } },
      update: { roles: [...grants.get(w.slug)!].join(",") },
      create: { userId: user.id, workspaceId: w.id, roles: [...grants.get(w.slug)!].join(",") },
    })),
  ]);
  // An enterprise admin with no workspace group still needs one workspace to land in.
  if (!workspaces.length && enterpriseAdmin) {
    const first = await db.workspace.findFirst({ orderBy: { createdAt: "asc" } });
    if (first) await db.workspaceMembership.upsert({ where: { userId_workspaceId: { userId: user.id, workspaceId: first.id } }, update: {}, create: { userId: user.id, workspaceId: first.id, roles: "consumer" } });
  }
  return user;
}

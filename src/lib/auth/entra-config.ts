import { z } from "zod";
import { ROLES } from "@/lib/permissions";

/**
 * Microsoft Entra ID (OIDC, authorization code + PKCE) configuration, all from the environment.
 *   AUTH_PROVIDER=entra
 *   ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET (Key Vault in production)
 *   APP_BASE_URL            e.g. https://knowledge-studio.essilorluxottica.com (redirect = <base>/api/auth/callback)
 *   ENTRA_GROUP_ROLE_MAP    JSON: { "<group object id>": { "workspace": "<slug>", "roles": ["creator", ...] }, ... }
 *   ENTRA_ENTERPRISE_ADMIN_GROUP  optional group id whose members are enterprise administrators
 * Roles come ONLY from group membership in the ID token; nothing in the request can grant one.
 */
export const isEntraEnabled = (env: Record<string, string | undefined> = process.env) => env.AUTH_PROVIDER === "entra";

const roleEnum = z.enum(ROLES);
const mapSchema = z.record(z.string().min(1), z.object({ workspace: z.string().min(1), roles: z.array(roleEnum).min(1) }));

export interface EntraConfig {
  tenantId: string; clientId: string; clientSecret: string; baseUrl: string;
  issuer: string; redirectUri: string;
  groupRoleMap: z.infer<typeof mapSchema>;
  enterpriseAdminGroup: string | null;
}

export function loadEntraConfig(env: Record<string, string | undefined> = process.env): EntraConfig {
  const v = z.object({
    ENTRA_TENANT_ID: z.guid("ENTRA_TENANT_ID must be the tenant's GUID."),
    ENTRA_CLIENT_ID: z.guid("ENTRA_CLIENT_ID must be the app registration's GUID."),
    ENTRA_CLIENT_SECRET: z.string().min(10, "ENTRA_CLIENT_SECRET is required."),
    APP_BASE_URL: z.string().url("APP_BASE_URL must be the app's public https URL."),
    ENTRA_GROUP_ROLE_MAP: z.string().default("{}"),
    ENTRA_ENTERPRISE_ADMIN_GROUP: z.string().optional(),
  }).parse(Object.fromEntries(Object.entries(env).filter(([, x]) => x !== undefined && x.trim() !== "")));
  const base = v.APP_BASE_URL.replace(/\/+$/, "");
  if (env.NODE_ENV === "production" && !base.startsWith("https://")) throw new Error("APP_BASE_URL must use https in production.");
  return {
    tenantId: v.ENTRA_TENANT_ID, clientId: v.ENTRA_CLIENT_ID, clientSecret: v.ENTRA_CLIENT_SECRET, baseUrl: base,
    issuer: `https://login.microsoftonline.com/${v.ENTRA_TENANT_ID}/v2.0`,
    redirectUri: `${base}/api/auth/callback`,
    groupRoleMap: mapSchema.parse(JSON.parse(v.ENTRA_GROUP_ROLE_MAP)),
    enterpriseAdminGroup: v.ENTRA_ENTERPRISE_ADMIN_GROUP ?? null,
  };
}

/** Workspace roles a user gets from their Entra groups. Groups not in the map grant nothing. */
export function rolesFromGroups(groups: readonly string[], map: EntraConfig["groupRoleMap"]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const g of groups) {
    const entry = map[g];
    if (!entry) continue;
    const set = out.get(entry.workspace) ?? new Set<string>();
    entry.roles.forEach((r) => set.add(r));
    out.set(entry.workspace, set);
  }
  return out;
}

/**
 * Entra app roles (the token's "roles" claim), the option most IAM teams prefer: assign users or
 * groups to roles on the enterprise application, no group ids in our configuration.
 * Value format: "<workspace-slug>.<role>" (e.g. "retail-europe.creator") or "enterprise-admin".
 * Unknown values grant nothing.
 */
export function rolesFromAppRoles(appRoles: readonly string[]): { grants: Map<string, Set<string>>; enterpriseAdmin: boolean } {
  const grants = new Map<string, Set<string>>();
  let enterpriseAdmin = false;
  for (const v of appRoles) {
    if (v === "enterprise-admin") { enterpriseAdmin = true; continue; }
    const dot = v.lastIndexOf(".");
    if (dot < 1) continue;
    const ws = v.slice(0, dot), role = v.slice(dot + 1);
    if (!(ROLES as readonly string[]).includes(role) || !/^[a-z0-9-]+$/.test(ws)) continue;
    const set = grants.get(ws) ?? new Set<string>();
    set.add(role);
    grants.set(ws, set);
  }
  return { grants, enterpriseAdmin };
}

/** Group grants and app-role grants combined (a user may have both). */
export function mergeGrants(...maps: Map<string, Set<string>>[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const m of maps) for (const [ws, roles] of m) out.set(ws, new Set([...(out.get(ws) ?? []), ...roles]));
  return out;
}

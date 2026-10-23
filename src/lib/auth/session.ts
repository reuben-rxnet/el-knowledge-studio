import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/lib/database/client";
import { csv } from "@/lib/domain/constants";
import { AuthorizationError, permissionsFor, type Permission } from "@/lib/permissions";
import { AppError } from "@/lib/utilities/errors";
import { isDemoAuthEnabled, SESSION_COOKIE, WORKSPACE_COOKIE } from "./demo";
import { isEntraEnabled } from "./entra-config";
import { verifySession } from "./session-cookie";

export interface Session {
  user: { id: string; displayName: string; initials: string; email: string; jobTitle: string; isEnterpriseAdmin: boolean };
  workspace: { id: string; name: string; slug: string; region: string };
  workspaces: { id: string; name: string; slug: string; region: string }[];
  roles: string[];
  permissions: Set<Permission>;
}

/**
 * Resolves the signed-in user and the active workspace. Workspace isolation: the active
 * workspace must be one the user is a member of — the cookie value alone is never trusted.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const jar = await cookies();
  // Signed, expiring token: a forged or edited cookie is rejected.
  const token = verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!token) return null;
  // A demo session is never honoured when demo auth is off (production); an Entra session only when Entra is configured.
  if (token.via === "demo" && !isDemoAuthEnabled()) return null;
  if (token.via === "entra" && !isEntraEnabled()) return null;
  const userId = token.uid;

  const user = await db.user.findUnique({
    where: { id: userId },
    include: { memberships: { include: { workspace: true }, orderBy: { createdAt: "asc" } } },
  });
  if (!user || user.memberships.length === 0) return null;

  const wanted = jar.get(WORKSPACE_COOKIE)?.value;
  const membership = user.memberships.find((m) => m.workspaceId === wanted) ?? user.memberships[0]!;
  const roles = csv(membership.roles);
  if (user.isEnterpriseAdmin) roles.push("enterprise-admin");

  const pick = (w: { id: string; name: string; slug: string; region: string }) => ({ id: w.id, name: w.name, slug: w.slug, region: w.region });
  return {
    user: { id: user.id, displayName: user.displayName, initials: user.initials, email: user.email, jobTitle: user.jobTitle, isEnterpriseAdmin: user.isEnterpriseAdmin },
    workspace: pick(membership.workspace),
    workspaces: user.memberships.map((m) => pick(m.workspace)),
    roles,
    permissions: permissionsFor(roles),
  };
});

/** For pages: redirect to sign-in when there is no session. */
export async function requirePageSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/sign-in");
  return s;
}

/** For server actions and route handlers: throw typed errors instead of redirecting. */
export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new AppError("UNAUTHENTICATED", "Your session has ended. Sign in again to continue.");
  return s;
}

export function assertPermission(session: Session, permission: Permission): void {
  if (!session.permissions.has(permission)) throw new AuthorizationError(permission);
}

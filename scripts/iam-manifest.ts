/**
 * Generates the Entra ID app registration manifest for the IAM team from the live workspaces and
 * the role list in code, so app roles always match what the application understands.
 *
 *   npm run iam:manifest -- --base-url https://knowledge-studio.example.com [--base-url http://localhost:3010]
 *
 * Writes infra/entra/app-registration.json. App role ids are derived from their value (UUID v5),
 * so regenerating never changes the id of an existing role.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { ROLE_LABELS, ROLES, type Role } from "../src/lib/permissions";

const NAMESPACE = "6f0c5a39-2c87-4d0e-9a2f-0e1d7b0e5a11"; // fixed namespace for EL Knowledge Studio app roles
function uuidV5(name: string) {
  const ns = Buffer.from(NAMESPACE.replace(/-/g, ""), "hex");
  const h = createHash("sha1").update(Buffer.concat([ns, Buffer.from(name)])).digest();
  h[6] = (h[6]! & 0x0f) | 0x50; h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

// Roles that make sense to assign per workspace through IAM (enterprise-admin is tenant-wide).
const WORKSPACE_ROLES = ROLES.filter((r) => r !== "enterprise-admin");

(async () => {
  const args = process.argv.slice(2);
  const bases = args.flatMap((a, i) => (a === "--base-url" && args[i + 1] ? [args[i + 1]!.replace(/\/+$/, "")] : []));
  if (!bases.length) bases.push("https://<app-host>");
  const db = new PrismaClient();
  const workspaces = await db.workspace.findMany({ orderBy: { name: "asc" } });
  await db.$disconnect();

  const appRoles = [
    { value: "enterprise-admin", displayName: "Enterprise administrator", description: "Global settings, all workspaces, AI provider and audit access." },
    ...workspaces.flatMap((w) => WORKSPACE_ROLES.map((r) => ({
      value: `${w.slug}.${r}`,
      displayName: `${w.name} · ${ROLE_LABELS[r as Role]}`.slice(0, 120),
      description: `${ROLE_LABELS[r as Role]} in the ${w.name} workspace.`,
    }))),
  ].map((r) => ({ allowedMemberTypes: ["User"], ...r, id: uuidV5(r.value), isEnabled: true, origin: "Application" }));

  const manifest = {
    displayName: "EL Knowledge Studio",
    signInAudience: "AzureADMyOrg",
    web: {
      redirectUris: bases.map((b) => `${b}/api/auth/callback`),
      logoutUrl: `${bases[0]}/sign-in`,
      implicitGrantSettings: { enableIdTokenIssuance: false, enableAccessTokenIssuance: false },
    },
    requiredResourceAccess: [{
      resourceAppId: "00000003-0000-0000-c000-000000000000", // Microsoft Graph
      resourceAccess: [
        { id: "37f7f235-527c-4136-accd-4a02d197296e", type: "Scope" }, // openid
        { id: "14dad69e-099b-42c9-810b-d002981feec1", type: "Scope" }, // profile
        { id: "64a6cdd6-aab1-4aaf-94b8-3cc8405e90d0", type: "Scope" }, // email
        { id: "e1fe6dd8-ba31-4d61-89e7-88639da4683d", type: "Scope" }, // User.Read
      ],
    }],
    groupMembershipClaims: "ApplicationGroup",
    optionalClaims: { idToken: [{ name: "email", essential: false }, { name: "groups", essential: false }] },
    appRoles,
  };
  const out = path.join(process.cwd(), "infra", "entra", "app-registration.json");
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Wrote ${path.relative(process.cwd(), out)}: ${appRoles.length} app roles for ${workspaces.length} workspace(s), redirect URIs: ${manifest.web.redirectUris.join(", ")}`);
})();

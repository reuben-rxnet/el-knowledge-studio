// Capability-based authorization. Roles map to permissions; code checks permissions, never role names.

export const PERMISSIONS = [
  "project.create",
  "project.view",
  "project.edit",
  "project.delete",
  "recording.create",
  "recording.download",
  "guide.edit",
  "translation.edit",
  "review.comment",
  "review.approve",
  "publish.execute",
  "analytics.view",
  "template.manage",
  "brand.manage",
  "workspace.manage",
  "audit.view",
  "enterprise.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = [
  "consumer",
  "creator",
  "editor",
  "reviewer",
  "sme",
  "translator",
  "approver",
  "publisher",
  "workspace-admin",
  "enterprise-admin",
  "auditor",
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  consumer: "Consumer",
  creator: "Creator",
  editor: "Editor",
  reviewer: "Reviewer",
  sme: "Subject-matter expert",
  translator: "Translator",
  approver: "Approver",
  publisher: "Publisher",
  "workspace-admin": "Workspace administrator",
  "enterprise-admin": "Enterprise administrator",
  auditor: "Auditor",
};

const CONSUMER: Permission[] = ["project.view"];
const AUTHOR: Permission[] = [...CONSUMER, "project.create", "project.edit", "recording.create", "guide.edit", "review.comment"];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  consumer: CONSUMER,
  creator: AUTHOR,
  editor: [...AUTHOR, "recording.download"],
  reviewer: [...CONSUMER, "review.comment", "review.approve"],
  sme: [...CONSUMER, "review.comment", "review.approve"],
  translator: [...CONSUMER, "translation.edit", "review.comment"],
  approver: [...CONSUMER, "review.comment", "review.approve", "analytics.view"],
  publisher: [...CONSUMER, "publish.execute", "review.comment", "analytics.view"],
  "workspace-admin": [
    ...AUTHOR,
    "project.delete",
    "recording.download",
    "review.approve",
    "publish.execute",
    "analytics.view",
    "template.manage",
    "workspace.manage",
    "audit.view",
  ],
  "enterprise-admin": PERMISSIONS,
  auditor: [...CONSUMER, "audit.view", "analytics.view"],
};

export function permissionsFor(roles: readonly string[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const r of roles) {
    const perms = ROLE_PERMISSIONS[r as Role];
    if (perms) perms.forEach((p) => out.add(p));
  }
  return out;
}

export function can(roles: readonly string[], permission: Permission): boolean {
  return permissionsFor(roles).has(permission);
}

export class AuthorizationError extends Error {
  readonly code = "PERMISSION_DENIED";
  constructor(public readonly permission: Permission) {
    super(`This action requires the "${permission}" permission.`);
  }
}

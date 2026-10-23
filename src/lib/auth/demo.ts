// Demo authentication — LOCAL DEVELOPMENT ONLY.
// Production identity is Microsoft Entra ID (OIDC); see docs/security.md.

export const SESSION_COOKIE = "elks_session";
export const WORKSPACE_COOKIE = "elks_ws";

/**
 * Demo auth is refused in production builds regardless of configuration, so it cannot be
 * enabled accidentally by a copied .env file.
 */
export function isDemoAuthEnabled(env: { NODE_ENV?: string; AUTH_PROVIDER?: string } = process.env): boolean {
  return env.AUTH_PROVIDER === "demo" && env.NODE_ENV !== "production";
}

export const DEMO_PERSONAS = [
  { email: "amara.mensah@demo.el-knowledge.test", persona: "Creator", blurb: "Records and authors retail procedures" },
  { email: "pierre.laurent@demo.el-knowledge.test", persona: "Reviewer (SME)", blurb: "Reviews store operations content" },
  { email: "chiara.bellini@demo.el-knowledge.test", persona: "Approver", blurb: "Approves content for release" },
  { email: "kenji.watanabe@demo.el-knowledge.test", persona: "Translator", blurb: "Localizes content for APAC" },
  { email: "sofia.ramirez@demo.el-knowledge.test", persona: "Publisher", blurb: "Releases approved content" },
  { email: "daniel.okafor@demo.el-knowledge.test", persona: "Workspace administrator", blurb: "Runs the Retail Europe workspace" },
  { email: "ines.duarte@demo.el-knowledge.test", persona: "Enterprise administrator", blurb: "Owns global platform settings" },
  { email: "leo.fischer@demo.el-knowledge.test", persona: "Consumer", blurb: "Store associate looking for answers" },
] as const;

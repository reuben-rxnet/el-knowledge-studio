import { defineConfig, devices } from "@playwright/test";

// Own ports + simulated AI: e2e never calls Codex and never reuses the app you have open on 3010.
const PORT = Number(process.env.E2E_PORT ?? 3011);
const SSO_PORT = 3012;
// Each server creates and seeds its own throwaway database; your dev.db is never touched.
const freshDb = (file: string) => `node -e "require('fs').rmSync('prisma/${file}', { force: true })" && npx prisma db push --skip-generate && npx tsx prisma/seed.ts`;
const desktop = { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } };

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { trace: "retain-on-failure" },
  projects: [
    // Demo personas (development sign-in).
    { name: "chromium", testIgnore: /entra-sso\.spec\.ts/, use: { ...desktop, baseURL: `http://localhost:${PORT}` } },
    // Company sign-in (Entra ID) against a local test identity provider.
    { name: "entra-sso", testMatch: /entra-sso\.spec\.ts/, use: { ...desktop, baseURL: `http://localhost:${SSO_PORT}` } },
  ],
  webServer: [
    {
      command: `${freshDb("e2e.db")} && npx next dev -p ${PORT}`,
      url: `http://localhost:${PORT}/sign-in`, reuseExistingServer: false, timeout: 180_000,
      env: { AI_PROVIDER: "mock", SPEECH_PROVIDER: "off", NEXT_DIST_DIR: ".next-e2e", DATABASE_URL: "file:./e2e.db", STORAGE_DIR: "./storage-e2e" },
    },
    { command: "node tests/e2e/fake-entra.mjs", url: "http://localhost:3020/11111111-2222-3333-4444-555555555555/v2.0/.well-known/openid-configuration", reuseExistingServer: false, timeout: 60_000 },
    {
      command: `${freshDb("e2e-sso.db")} && npx next dev -p ${SSO_PORT}`,
      url: `http://localhost:${SSO_PORT}/sign-in`, reuseExistingServer: false, timeout: 180_000,
      env: {
        AUTH_PROVIDER: "entra", AI_PROVIDER: "mock", SPEECH_PROVIDER: "off", NEXT_DIST_DIR: ".next-e2e-sso", DATABASE_URL: "file:./e2e-sso.db", STORAGE_DIR: "./storage-e2e",
        ENTRA_TENANT_ID: "11111111-2222-3333-4444-555555555555", ENTRA_CLIENT_ID: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", ENTRA_CLIENT_SECRET: "test-client-secret-not-a-real-one",
        APP_BASE_URL: `http://localhost:${SSO_PORT}`, ENTRA_ISSUER_OVERRIDE: "http://localhost:3020/11111111-2222-3333-4444-555555555555/v2.0", SESSION_SECRET: "e2e-only-session-secret-0123456789abcdef",
      },
    },
  ],
});

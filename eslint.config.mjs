import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // prototype/ is the standalone published artifact (plain browser JS), not part of the app.
    ignores: [".next/**", ".next-e2e/**", ".next-e2e-sso/**", "storage/**", "storage-e2e/**", "eval/results/**", "node_modules/**", "playwright-report/**", "test-results/**", "next-env.d.ts", "prototype/**"],
  },
];

export default config;

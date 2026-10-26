import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Content Security Policy. 'unsafe-inline' for styles is required by Next.js runtime style injection;
// 'unsafe-eval' is only allowed in development for React Refresh.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  // Direct uploads (STORAGE_PROVIDER=azure-blob) PUT the file straight to Blob storage. Headers are fixed at
  // build time, so pin the account with CSP_BLOB_ORIGIN (e.g. https://<account>.blob.core.windows.net) when
  // building the image; otherwise any Azure Blob endpoint is allowed. Development: the Azurite emulator.
  `connect-src 'self' ${process.env.CSP_BLOB_ORIGIN?.trim() || (isDev ? "http://127.0.0.1:10000 http://localhost:10000" : "https://*.blob.core.windows.net")}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  // A separate build folder lets the e2e server run beside your dev server.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The container image builds a standalone server (NEXT_OUTPUT=standalone in the Dockerfile).
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  poweredByHeader: false,
  // Native, open-source media/AI packages run as plain Node modules on the server (not bundled).
  serverExternalPackages: ["tesseract.js", "tesseract.js-core", "@napi-rs/canvas", "@azure/storage-blob", "@azure/identity", "@huggingface/transformers", "onnxruntime-node", "kokoro-js", "sharp", "ffmpeg-static"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          // Screen capture and microphone are allowed for this origin only (recording feature).
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), display-capture=(self), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;

# Deployment

`infra/main.bicep` describes the pilot environment; the `Dockerfile` builds the image it runs.

| Concern | Azure service | In this build |
| --- | --- | --- |
| Web app | Azure Container Apps (Next.js standalone output), 1–3 replicas | `Dockerfile`, health at `/api/health` (`?ready=1` also checks the database and storage) |
| Identity | Microsoft Entra ID (OIDC) | See `iam-registration.md`. Demo auth is refused in production builds |
| Database | Azure Database for PostgreSQL Flexible Server | The image switches Prisma to PostgreSQL at build time (`scripts/prisma-provider.mjs`) and applies the schema on start (`prisma db push`). Production: run migrations as a release step |
| Media | Azure Blob Storage, one private container (`media`) | `STORAGE_PROVIDER=azure-blob`, managed identity (`AZURE_STORAGE_ACCOUNT_URL`), shared keys disabled. FFmpeg and Whisper work on a temporary local copy that is deleted afterwards |
| Jobs | In-process (`after()` with a lease) | Service Bus / Container Apps Jobs when volumes need it |
| AI | OpenAI Codex through EssilorLuxottica APIM (see `integrations.md`) | Speech runs locally (Whisper, Kokoro); the gateway has no audio routes |
| Publishing | Knowzy: a synchronized folder | `KNOWZY_EXPORT_DIR` (see below). SharePoint, Teams, Stream and Leonardo are still simulated |
| Secrets | Azure Key Vault | Container Apps Key Vault references with the app's managed identity: `ENTRA_CLIENT_SECRET`, `SESSION_SECRET`, `DATABASE_URL`, `OPENAI_API_KEY` arrive as environment variables. No secrets in app settings or the image. A rotated secret takes effect on the next revision restart |
| Abuse limits | In memory, per replica | `src/lib/utilities/rate-limit.ts` (below) |
| Telemetry | Application Insights (redacted) | Not wired yet |

## Knowzy export

Knowzy reads approved guides from a folder through its `FILE_REPOSITORY` source. When a publisher publishes to Knowzy, the app writes:

```
<KNOWZY_EXPORT_DIR>/<workspace-slug>/<projectId>.<language>.md
<KNOWZY_EXPORT_DIR>/<workspace-slug>/<projectId>.<language>.md.meta.json   (Knowzy's sidecar: version, approval date, metadata)
```

- The name never changes for a project and language, so republishing updates the same Knowzy document.
- Files are written under a temporary name and renamed, so a sync never reads half a file.
- Only the approved version is exported. While a newer version is being edited the export is refused, because steps are not yet stored per version.
- Translations are exported only once approved.
- The sidecar declares no access rules: Knowzy's own source boundary and authorization decide who sees the content.
- In Azure, mount an Azure Files share (or a synced SharePoint library) at the export path, and point the Knowzy source at the same share.

## Uploads

- **Limits per file type** are set by platform administrators on the Administration page (stored in the `AppSetting` table, audited). Defaults: video 1 GB, audio 500 MB, PowerPoint 300 MB, PDF 200 MB, Word 100 MB, images 25 MB, text 10 MB.
- **`UPLOAD_CEILING_MB`** (default 2048) is the most anyone can set there. Size it to the environment: storage, and any proxy or WAF in front of the app.
- **Streaming:** the browser sends the file as the request body and the server writes it to storage as it arrives, counting and hashing on the way. Memory use doesn't grow with file size, and an upload over its limit is stopped mid-stream with nothing left behind.
- **Trim and split:** after a video or audio upload, the creator can trim it or split it into up to 20 parts (`/api/uploads/edit`, FFmpeg stream copy: fast, no quality loss, cuts on the nearest keyframe). Each part becomes its own project, and the parts link to each other on the project page.
- **Production:** for files near 1 GB, upload straight from the browser to Blob Storage with a short-lived, write-only SAS URL (chunked, resumable), so large uploads never pass through the app. Check with IT whether Front Door or the WAF limits request body size on the app's route.
- Uploads that never become a project (abandoned, or the original of a trimmed file) stay in storage. A clean-up job for these is still to do.

## Rate limits

| What | Limit | Key |
| --- | --- | --- |
| AI requests (script rewrites, Knowledge Hub answers) | 30 per 10 min | user |
| New drafts (create project, regenerate) | 20 per hour | user |
| Uploads | 30 per 10 min | user |
| Video renders | 10 per hour | user |
| Feedback messages | 10 per hour | user |
| Sign-in starts | 20 per 5 min | client IP |

The counters are kept per replica, so with three replicas a user can get up to three times the limit. That is acceptable for the pilot. Use Redis if the limits must be exact.

## Local production check

```bash
docker run -d --name elks-postgres -e POSTGRES_USER=elks -e POSTGRES_PASSWORD=elks-local-only -e POSTGRES_DB=elks -p 5434:5432 postgres:16-alpine
docker run -d --name elks-azurite -p 10000:10000 mcr.microsoft.com/azure-storage/azurite azurite-blob --blobHost 0.0.0.0
docker build -t el-knowledge-studio .
# Run on a shared Docker network with DATABASE_URL, SESSION_SECRET, STORAGE_PROVIDER=azure-blob and an Azurite connection string.
AZURITE_TEST=1 npx vitest run tests/unit/storage.test.ts   # the storage contract against the emulator
```

## Before production

Replace the placeholder product mark. Set the real host name, then re-run `npm run iam:manifest`. Record the AI data-processing approval. Clear the FFmpeg licence with Legal (`third-party.md`). Finish language review for UI text that isn't in English. Set `MOCK_PUBLISHING_CONNECTORS=false` only after the Graph connectors are registered.

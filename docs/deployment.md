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

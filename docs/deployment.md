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
- **Direct to Blob (production, `STORAGE_PROVIDER=azure-blob`):** large files don't pass through the app. The browser asks `GET /api/uploads/direct` whether it's on, then `POST /api/uploads/direct` with the file's name, type and size: the app runs the same checks as `/api/uploads` (permission, rate limit, type, size against the limits) and returns a workspace-prefixed storage key, a signed ticket and a **15-minute SAS URL for exactly that blob, create and write only** (no read, list or delete). In Azure it is a *user delegation* SAS signed through the managed identity (shared keys stay disabled); with Azurite (`AZURE_STORAGE_CONNECTION_STRING`) an account-key SAS. The browser sends 8 MB blocks (Put Block, 4 in parallel, each retried 3 times) and commits them (Put Block List), renewing the URL while a long upload runs. `POST /api/uploads/direct/complete` then checks the ticket (same user, same workspace, same key), that the blob exists and its **real** size is within the type's limit (otherwise it is deleted), hashes it by streaming (SHA-256), and returns the same answer as `/api/uploads`. Local storage keeps the streaming path.
  - **Blob CORS rule** (in `infra/main.bicep`): allowed origin = the app's URL (`appBaseUrl`), methods `PUT` and `OPTIONS`, allowed headers `content-type, x-ms-*`, exposed headers `x-ms-*, etag`, max age 3600 s.
  - **Roles for the app's managed identity** on the storage account: *Storage Blob Data Contributor* and *Storage Blob Delegator* (both in Bicep).
  - **Content Security Policy:** the page may connect to the Blob endpoint. Headers are fixed when the image is built, so set `CSP_BLOB_ORIGIN=https://<account>.blob.core.windows.net` at build time to pin the account; without it any `*.blob.core.windows.net` endpoint is allowed.
  - Check with IT whether Front Door or the WAF limits request body size on the app's route (only relevant for local storage now).
  - Test against the emulator: `AZURITE_TEST=1 npx vitest run tests/unit/direct-upload-azurite.test.ts` (Azurite on port 10000).
- Uploads that never become a project (abandoned, or the original of a trimmed file) stay in storage. A clean-up job for these is still to do.

## Studio (beta)

The new timeline editor, a tab next to Video while the `studio-beta` feature flag is on. The Video tab and its renders are unchanged.

- **Edit list:** each project's edits are stored as one JSON document (`StudioEdit`, format in `src/lib/studio/edl.ts`): clips (cut, reordered, trimmed, sped up) and blur boxes anchored to the recording. The original file is never changed. Saves carry a revision, so a stale save is refused instead of overwriting someone else's.
- **Preview = render:** the browser plays the edit (jumping between clips at their speeds, drawing blur boxes and captions over the video); the server renders the same list.
- **Rendering:** one FFmpeg segment per clip (frame-accurate seek, speed, blur boxes, burned-in captions), then joined without re-encoding. Memory stays flat for long recordings. Renders are stored with `engine = "studio"`; the Video tab lists only its own.
- **Phase 1 scope:** recordings and videos (not audio-only or documents); original audio only (no AI voice yet); captions in the primary language.
- **Phase 2:**
  - **Edit by text:** word timings from Whisper (`onnx-community/whisper-base_timestamped`, set `LOCAL_STT_WORDS_MODEL` for a larger one), kept on the source file. Deleting words cuts that stretch from the edit; "Tidy up" removes filler words and shortens pauses in one undo step.
  - **Annotations:** box, arrow, text callout, step number and spotlight, drawn by one shared canvas routine: in the preview, and on the server as transparent PNGs overlaid by FFmpeg.
  - **Audio:** noise reduction (`afftdn`) per clip; even volume (`loudnorm`, EBU R128) as a second pass on the audio only. Render-only; the preview plays the original sound.
  - **Personal data:** a frame every 2 s, text read with Tesseract (only when the screen changed), rules for emails, phone numbers and names of workspace members, optional Codex check of the read text (Administration › "Personal data in Studio", off by default). Found boxes replace earlier found ones; hand-drawn boxes stay. Tesseract's English data (about 10 MB) downloads into `MODELS_DIR/tesseract` on first use: pre-load it in the image if servers have no internet access.

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

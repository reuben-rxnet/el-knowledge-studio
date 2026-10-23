# EL Knowledge Studio

**Capture once. Share knowledge everywhere.**

EL Knowledge Studio is EssilorLuxottica's enterprise platform for turning business processes into videos, step-by-step guides, training content and searchable knowledge with enterprise AI. Employees record a process or upload content. AI drafts a video, a guide and an article. People review and approve a specific version, publishers release it to approved destinations, and everyone finds it in the Knowledge Hub with grounded, cited answers.

> **Status: vertical slice (prototype).** The whole creation → review → approval → publishing → search journey works end to end on local data. Identity, storage, transcription, rendering and publishing use **clearly labelled mocks**. The AI provider can be switched to **OpenAI Codex through the EssilorLuxottica APIM gateway** (the same setup as Knowzy). See [Mock-provider disclosure](#mock-provider-disclosure).

## What works today

| Area | Implemented |
| --- | --- |
| Shell | Collapsible navigation, workspace selector, Create menu, processing-jobs indicator, notifications, skip link, mobile drawer |
| Demo authentication | Persona sign-in and in-app persona switcher. **Refused in production builds** |
| Dashboard | Hero, live KPIs computed from data, continue working, review inbox, activity, trending |
| Create | Four creation routes, 5-step wizard with validation, classification and destination policy |
| Recording | Real `getDisplayMedia` capture, optional mic with level meter, countdown, floating controller, pause/resume/stop, preview, trim, re-record, unsupported-browser fallback |
| Upload | Drag-and-drop, extension/MIME/size/empty-file checks, decode check, duplicate detection by fingerprint, scan step, cancel |
| Processing | 15 stages in 7 phases, deterministic and idempotent, polling API, retry, cancel, screen-reader announcements |
| Project | Overview, version history, metadata, generated assets, activity feed |
| Video editor | Chapters, timeline tracks, scene properties (rename, focus zoom, redaction), synchronized script, AI rewrites, lock approved text, compare with transcript |
| Guide editor | Outline, editable steps, warnings/tips, add/delete/reorder, timestamp links to the video |
| Review | Anchored comments with @mentions, resolve, SME → approver workflow, version-bound decisions, required justification for changes |
| Publishing | Classification-aware destinations, mock connectors labelled "simulated", publishing history |
| Knowledge Hub | Permission-trimmed search of approved versions, grounded answer with citations, timestamps, freshness, "not enough evidence", feedback |
| Governance | Immutable audit log, capability-based permissions enforced in every server action, workspace isolation |

## Architecture summary

Next.js 16 (App Router, React Server Components by default) · TypeScript strict · Prisma (SQLite locally, PostgreSQL target) · Zod validation · Tailwind v4 with design tokens. Business logic lives in server actions and services (`src/server`, `src/lib`), not UI components. External services sit behind typed interfaces (`src/lib/services/interfaces.ts`) with mock and production implementations. See [docs/tech-stack.md](docs/tech-stack.md) and [docs/architecture.md](docs/architecture.md).

## Prerequisites

- Node.js 20+ (tested on 24)
- npm 10+

## Setup

```bash
npm install
cp .env.example .env
npm run setup        # prisma generate + create database + seed demo data
npm run dev          # http://localhost:3000
```

npm 11 blocks dependency install scripts by default. The required ones (Prisma engines, esbuild) are pre-approved in `package.json` under `allowScripts`.

## Environment variables

See [.env.example](.env.example). Highlights:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | SQLite file locally, PostgreSQL in production |
| `AUTH_PROVIDER` | `demo` enables the persona switcher (development only) |
| `AI_PROVIDER` | `mock` (default, offline) or `openai` (Codex) |
| `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_API_STYLE`, `OPENAI_AUTH_*`, `OPENAI_EXTRA_HEADERS` | Codex endpoint settings (APIM gateway defaults pre-filled) |
| `OPENAI_API_KEY` | Gateway subscription key. **Local `.env` only. Never commit.** |
| `LLM_ENDPOINT_ALLOWLIST` | Hosts the key may be sent to |
| `AI_DATA_PROCESSING_APPROVAL_REF` | External AI stays blocked until this is set |
| `MOCK_PUBLISHING_CONNECTORS` | `true`: all publishing is simulated |

### Using OpenAI Codex (as in Knowzy)

1. Set `AI_PROVIDER=openai` in `.env`.
2. Put the gateway subscription key in `OPENAI_API_KEY`.
3. Record the data-processing approval reference in `AI_DATA_PROCESSING_APPROVAL_REF`.
4. Restart. **Administration → AI provider** shows the configuration without revealing the key.

Codex then does everything the simulated AI did: guide, chapters, script, FAQ, knowledge article, sensitive-information flags, quiz, translations, script rewrites and Knowledge Hub answers, working from uploaded documents and your process notes. Use **Administration → Test connection** to check the key. Speech-to-text needs a transcription model on the gateway (`OPENAI_TRANSCRIBE_MODEL`). See [docs/integrations.md](docs/integrations.md).

## Database migration and seeding

```bash
npm run db:push      # apply schema (prototype uses db push; production uses prisma migrate)
npm run db:seed      # reset demo data
npm run db:reset     # drop, recreate and seed
```

## Running locally and testing

```bash
npm run dev
npm run lint
npm run typecheck
npm test             # Vitest unit tests
npm run test:e2e     # Playwright journeys + axe accessibility (starts a dev server on :3010)
```

Run `npx playwright install chromium` once before the first e2e run.

## Demo accounts

All people are fictional. Sign in at `/sign-in`, or switch persona from the top bar.

| Persona | Name | Workspaces |
| --- | --- | --- |
| Creator | Amara Mensah | Retail Operations · Europe (creator), Global Corporate (consumer) |
| Reviewer (SME) | Pierre Laurent | Retail Europe, Operations & Supply Chain |
| Approver | Chiara Bellini | Retail Europe, Global Corporate |
| Translator | Kenji Watanabe | Retail Europe, Global Corporate |
| Publisher | Sofía Ramírez | Retail Europe, Global Corporate |
| Workspace administrator | Daniel Okafor | Retail Europe |
| Enterprise administrator | Inês Duarte | All workspaces |
| Consumer | Leo Fischer | Retail Europe |

## Mock-provider disclosure

| Capability | Prototype implementation | Labelled in UI |
| --- | --- | --- |
| Identity | Demo persona cookies (dev only) | Sign-in screen, top bar |
| AI generation, article, quiz, translation, rewrite, answers | Deterministic mock **or** OpenAI Codex (live pipeline either way) | AI provider label on every AI surface. Mock translations are prefixed "[FR · simulated]" |
| Document text extraction | Real (PDF, DOCX, PPTX, TXT) | Shown on the processing page |
| Transcription | **Real**: open-source Whisper on the server (or the gateway, if it ever offers a model) | Processing page names the engine |
| AI voiceover | **Real**: open-source Kokoro on the server, English voices. Other languages use the browser preview voice | Video tab |
| Video playback, rendering, screenshots, captions | **Real**: recordings stream with seeking; FFmpeg renders MP4s (captions, blur, narration); screenshots are captured from the recording; WebVTT caption files per language | Video and Guide tabs |
| Visual scene detection | Not available (chapters come from narration and steps) | Processing page says why |
| File storage | Local disk (`storage/`), workspace-scoped keys | Upload panel note |
| Malware scan | Mock: always clean | Processing page |
| Publishing (SharePoint, Stream, Teams, Leonardo, Knowzy) | Mock connectors | "Simulated" / "Mock connectors" labels |
| Search | In-database term matching | — |

Nothing is reported as a successful production integration when a mock was used.

## Production integration notes

See [docs/deployment.md](docs/deployment.md) and [docs/integrations.md](docs/integrations.md): Entra ID (OIDC), PostgreSQL, Azure Blob Storage, Service Bus with Durable Functions, Azure AI Speech, Video Indexer, Translator, AI Search, Microsoft Graph and Key Vault.

## Documentation

[Tech stack](docs/tech-stack.md) · [Architecture](docs/architecture.md) · [Design system](docs/design-system.md) · [Security](docs/security.md) · [Responsible AI](docs/responsible-ai.md) · [Data model](docs/data-model.md) · [Integrations](docs/integrations.md) · [Local development](docs/local-development.md) · [Deployment](docs/deployment.md) · [Testing](docs/testing.md) · [Product workflows](docs/product-workflows.md) · [Open-source components](docs/third-party.md)

The product mark is a **text placeholder** (`EL | Knowledge Studio`) and must be replaced by an approved EssilorLuxottica corporate asset.

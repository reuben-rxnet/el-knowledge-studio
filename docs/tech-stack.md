# Tech stack

## In use today

### Frontend

| Technology | Version | Role |
| --- | --- | --- |
| Next.js (App Router, Turbopack) | 16 | Routing and rendering. Pages are server-rendered by default; only interactive parts (editors, wizard, recorder, shell menus) are client components |
| React | 19 | UI |
| TypeScript | 5.9, strict | Language. TypeScript 7 is deliberately not used yet |
| Tailwind CSS | v4 | Styling, bound to the design tokens in `src/app/globals.css` (see [design-system.md](design-system.md)) |
| Lucide | — | Icons |

Browser APIs:
- `getDisplayMedia` and `MediaRecorder` for screen recording
- Web Audio for the microphone level meter
- Web Crypto for upload fingerprints (duplicate detection)

### Backend

| Technology | Version | Role |
| --- | --- | --- |
| Next.js server actions | — | Every mutation: create, edit, review, publish |
| Next.js route handler | — | `/api/jobs/[id]` for processing progress |
| Prisma | 6 | Database access. **SQLite** locally, **PostgreSQL** as the production target |
| Zod | 4 | Validation shared by client and server |

### AI

- **OpenAI Codex** through the EssilorLuxottica API Management gateway, set up the same way as Knowzy (see [integrations.md](integrations.md)).
- A deterministic, offline **mock** is the default.
- Switch with `AI_PROVIDER=mock` or `AI_PROVIDER=openai`.

### Authentication

- Demo persona sign-in for local development only. It is refused in production builds.
- Microsoft Entra ID is planned and not yet connected.

### Quality and testing

| Tool | Role |
| --- | --- |
| Vitest | Unit tests (`tests/unit`) |
| Playwright | End-to-end journeys (`tests/e2e`) |
| axe-core | WCAG 2.2 AA accessibility checks inside the Playwright suite |
| ESLint | Next core-web-vitals and TypeScript rules |

See [testing.md](testing.md).

## Planned for production (Azure)

Each of these is an interface or a simulation in the code today.

| Need | Service |
| --- | --- |
| Hosting | Azure Container Apps |
| Database | Azure Database for PostgreSQL |
| File storage | Azure Blob Storage |
| Background jobs | Azure Service Bus with Durable Functions |
| Speech to text and voiceover | Azure AI Speech |
| Translation | Azure AI Translator |
| Search | Azure AI Search |
| Video analysis | Azure AI Video Indexer |
| Publishing to SharePoint, Teams and Stream | Microsoft Graph |
| Secrets | Azure Key Vault |
| Monitoring | Application Insights |

See [deployment.md](deployment.md).

## Libraries from the brief that are not used yet

These were left out to keep the first version small. Any of them can be added as the app grows.

| Library in the brief | Used instead |
| --- | --- |
| shadcn/ui and Radix | The project's own components (`src/components`) |
| React Hook Form | Plain React form state with Zod |
| TanStack Query and Zustand | Server-side data loading and React state |
| Recharts | Simple CSS bar charts on the Analytics page |
| Framer Motion | CSS transitions, disabled under `prefers-reduced-motion` |
| next-intl | Not added. All interface text is still in English |

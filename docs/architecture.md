# Architecture

For the technologies and versions used, see [tech-stack.md](tech-stack.md).

## Layers

```
src/app/                 Routes (server components by default)
  sign-in/               Demo persona sign-in (development only)
  (authenticated)/       Everything behind a session: shell layout + pages
  api/jobs/[id]/         Job progress polling (JSON, consistent error envelope)
src/components/          UI only. Client components only where interaction needs them
src/server/              Application layer
  actions/               Server actions: validate → authorize → isolate → mutate → audit
  jobs/                  ContentGenerationJob orchestration (idempotent)
  queries.ts             Workspace-scoped reads (IDOR protection)
  search.ts              Permission-trimmed search + grounded answer
  audit.ts               Append-only audit writer
src/lib/
  auth/                  Session resolution, demo-auth guard
  permissions/           Capability map (roles → permissions)
  domain/                Vocabularies, classification policy, freshness
  validation/            Zod schemas shared by client and server
  services/              Interfaces, mock providers, OpenAI Codex client, prompts, registry
prisma/                  Schema, seed data
tests/unit, tests/e2e    Vitest, Playwright + axe
```

## Request flow for a mutation

1. A client component calls a server action (for example `decideReview`).
2. `requireSession()` resolves the user and active workspace from the session cookie. Workspace membership is re-checked: the cookie value alone is never trusted.
3. `assertPermission()` checks a capability (`review.approve`), never a role name.
4. Zod validates input.
5. `findProject()` loads the resource **scoped to the active workspace**. Other workspaces answer like missing resources.
6. Domain rules: version binding, state transitions, classification policy.
7. Mutation in a transaction, then `recordAudit()`.
8. `run()` converts any failure to `{ code, message, correlationId, details }`, with no stack traces.

## Processing (ContentGenerationJob)

- Stages are defined in `src/lib/services/processing-plan.ts` (15 stages in 7 user-facing phases).
- Progress is derived from `startedAt` and elapsed time, so every poller sees the same state and no worker process is needed.
- When the last stage completes, the first poller claims the write with `updateMany({ where: { materialized: false } })`, so generated content is written **exactly once**.
- AI output is validated with `generatedContentSchema` before storage. On failure the job is marked `failed`, the project returns to `draft`, the source is kept, the owner is notified and an audit event records the error **code** only.
- Production: one Durable Functions orchestration per job, activities per stage, progress events through Service Bus. The same `ProcessingJob` row is the read model.

## Versioning and approval

- `Project.currentVersion` is the working version. `approvedVersion` and `publishedVersion` point at immutable approved and published versions.
- A review request records the version it applies to. A decision is refused if the project has moved on (`VERSION_CONFLICT`).
- Editing an approved or published project creates version *n + 1* as a draft. The approved version stays live.
- Every content edit carries `expectedVersion` (optimistic concurrency).

## Service abstraction

`src/lib/services/registry.ts` selects implementations:

- `AI_PROVIDER=mock`: deterministic, offline mock.
- `AI_PROVIDER=openai`: OpenAI Codex via `callStructured()` (see [integrations.md](integrations.md)).
- Publishing connectors implement `PublishingConnector`. Mocks return `simulated: true`, which the UI and audit show.

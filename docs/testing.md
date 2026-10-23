# Testing

| Command | What it runs |
| --- | --- |
| `npm run lint` | ESLint (Next core-web-vitals + TypeScript) |
| `npm run typecheck` | `tsc --noEmit`, strict |
| `npm test` | Vitest unit tests (`tests/unit`) |
| `npm run test:e2e` | Playwright journeys and axe checks (`tests/e2e`). Starts a dev server on :3010 |

## Unit coverage

Permissions (capabilities, audit access), demo-auth production guard, processing determinism and terminal states, validation (projects, decisions, uploads), classification policy, freshness, schema-valid mock AI output, protected-term preservation, insufficient-evidence answers, and the Codex client: query-parameter key, fixed header, strict schema, `store:false`, Bearer and Chat Completions mode, host allow-list, https and credential-in-URL refusal, retry policy, no retry on malformed output, no provider message kept, URL redaction, extra-header rules, uncited answers discarded.

## End-to-end journeys (`tests/e2e/vertical-journey.spec.ts`)

1. Creator creates through the wizard, processing completes, edits a script paragraph and a guide step, comments with an @mention, and submits for review.
2. SME approves. The approver approves the exact version.
3. Translator reviews machine translations and approves a language (`phase1-trust.spec.ts`), after the SME is blocked from approving until a risky AI flag is decided, and quiz questions are approved one by one.
4. Publisher publishes to mock SharePoint. The "simulated" label is asserted.
5. Consumer asks a question, gets a grounded answer and opens the cited video chapter.

Plus: the audit trail contains each step, permissions are enforced server-side (consumer blocked from Create and Audit, a cross-workspace project returns 404), and axe finds no serious or critical WCAG 2.2 AA violations on Home, the Knowledge Hub and the Library.

## Test isolation

`npm run test:e2e` starts its own server on port 3011 with `AI_PROVIDER=mock`, its own build folder (`.next-e2e`), its own storage folder (`storage-e2e`) and a fresh throwaway database (`prisma/e2e.db`, deleted and re-seeded each run). It never calls Codex and never touches `dev.db` or the app you have open on 3010.

## AI evaluation (`npm run eval`)

Runs every procedure in `eval/fixtures/` through the **real** AI provider configured in `.env` (Codex) and checks the output automatically:

| Check | Fails when |
| --- | --- |
| Valid output | The model's answer doesn't match the schema |
| Protected terms kept | A system, server or product name from the fixture is missing |
| Warnings kept | A warning listed in the fixture is lost |
| Warnings shown once | Every warning was lost (repeats are removed by the app and reported) |
| Risky lines flagged | A statement the fixture marks as risky is not in the AI review flags |
| Document citations | A document step has a timestamp or no page/section reference |
| No invented numbers | A step contains a number (IP, value, count) that isn't in the source |
| Classification suggestion | The suggestion is below the fixture's minimum |
| Quiz avoids flagged lines | A quiz question tests a flagged statement |

Two fictional fixtures are included. Add real procedures as `eval/fixtures/<name>.(txt|docx|pptx|pdf)` with an optional `<name>.expect.json`. Only use real content if your data-processing approval covers it. Results are saved in `eval/results/` (git-ignored). Last run against `gpt-5.3-codex_codeassist`: 17/17 checks passed on the two fictional fixtures.

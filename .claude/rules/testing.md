---
paths:
  - 'test/**'
---

# API tests

- Node's `node:test` + `node:assert/strict`. HTTP tests use `supertest` against `createApp()` (no
  port is opened). Node runs the `.ts` files directly. Layout: `test/helpers`, `test/unit`,
  `test/api` (one file per router).
- Production code has **no test seams**; keep it that way. The patterns below make that workable.
- **One process per file** (`--test-isolation=process`). `config` is read once at import, so call
  `setTestEnv({...})` / `loadApp({...})` (`test/helpers/env.ts`) **before** importing anything that
  reaches `config.ts`, then use `await import(...)`; static imports are hoisted. A different
  environment (Oncade on/off, production/development) needs a separate file. `setTestEnv` sets or
  deletes every variable config reads, and tests never load `.env`.
- `config.test.ts` re-evaluates config per case by importing `config.ts?load=N`.
- **Stub Oncade by mocking `fetch`** with `mockOncade(t, { 'GET /invoices/inv_1': reply })`
  (`test/helpers/oncade.ts`), keyed on the path below `/api/v1/platform`. An unexpected request
  fails the test, so nothing reaches the network. supertest uses `node:http`, so it is unaffected.
  Don't reach for `mock.module` (experimental flag).
- **In-memory storage is shared by the tests in a file.** Create plans with `uniquePlanCode()`,
  restore any client whose plan you change, and assert on known ids (`test/helpers/fixtures.ts`)
  rather than list counts.
- `captureConsole()` (`test/helpers/console.ts`) silences and records `console.error`/`warn`; use it
  to check the API key and client PII never reach a log line.
- Coverage: `npm run test:coverage` (c8, all of `src/api` except `server.ts`, no thresholds).

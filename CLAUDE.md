# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A micro SaaS admin panel: an Express JSON API and a React UI living in **one npm package** (no
workspaces, one `package.json`, one lockfile). In production Express serves the built React bundle
itself, so the whole app is a single process on a single port.

## Commands

| Command                           | What it does                                                          |
| --------------------------------- | --------------------------------------------------------------------- |
| `npm run dev`                     | Runs `dev:api` and `dev:ui` together (uses `&`, so POSIX shells only) |
| `npm run dev:api`                 | Express on :3000 via `node --watch src/api/server.ts`                 |
| `npm run dev:ui`                  | Vite dev server on :5173, proxying `/api` → :3000                     |
| `npm run build`                   | `build:ui` (Vite → `dist/ui`) then `build:api` (tsc → `dist/api`)     |
| `npm start`                       | Runs the built server from `dist/api/server.js`                       |
| `npm run typecheck`               | `tsc --noEmit` against the api, ui and test tsconfigs                 |
| `npm test`                        | `node --test` over `test/**/*.test.ts` (API only, see Testing)        |
| `npm run test:coverage`           | `c8 npm test`: summary in the terminal, HTML in `coverage/index.html` |
| `npm run lint` / `lint:fix`       | oxlint (`--fix` to autofix)                                           |
| `npm run format` / `format:check` | Prettier write / check                                                |
| `npm run update:deps`             | `npx npm-check-updates`                                               |

Run one file with `node --test test/api/plans.api.test.ts`.

## Linting: oxlint, not ESLint

The linter is **oxlint** (`.oxlintrc.json`), and this is not an arbitrary preference — do not
"restore" ESLint here. `typescript-eslint` enforces `"typescript": ">=4.8.4 <6.1.0"` with a runtime
guard, so it throws outright against this project's `typescript@7.0.2` (the native Go port). An npm
`overrides` entry silences the install-time peer error but cannot satisfy the runtime guard, and
scoping the override to the `@typescript-eslint/*` packages still leaves npm rejecting the root peer
conflict. oxlint parses TypeScript itself and declares no `typescript` peer at all, so the latest
compiler and a working linter coexist. (Upstream: `typescript-eslint#10940`, targeting TS ≥ 7.1.)

These rules are switched off or narrowed in `.oxlintrc.json` for real reasons, not to paper over
findings:

- `oxc/no-async-endpoint-handlers`, scoped to `src/api` — the rule assumes Express 4. Express 5
  forwards a rejected promise from an async handler to `errorHandler`, so async handlers are safe.
- `no-underscore-dangle` allows `_id`, scoped to `src/api` — it is Oncade's field name.

- `react/react-in-jsx-scope` — the project uses the modern automatic JSX transform
  (`jsx: react-jsx`), so `React` need not be in scope.
- `import/no-unassigned-import`, scoped to `src/ui` — `import './styles.css'` is a deliberate
  Vite side-effect import.

`oxlint-tsgolint` would add type-aware rules; it is an optional peer and is not installed.

## Architecture

### Request pipeline (`src/api/app.ts`)

Middleware order is load-bearing — `createApp()` registers, in sequence:

1. `helmet()` — security headers (CSP, HSTS, `nosniff`, frame/COOP/CORP, `Referrer-Policy`) on
   every response, so it must stay first. It uses helmet's default CSP, which suits the Vite build
   because that build has no inline scripts. `upgrade-insecure-requests` is dropped when
   `NODE_ENV` is `development` **or unset**, because `config.nodeEnv` defaults to `development`
   (Safari would otherwise upgrade `http://localhost` to https). Deploys outside Docker must set
   `NODE_ENV=production` explicitly. If the UI starts
   loading a third-party origin (fonts, analytics, an API), add it to the matching CSP directive here.
2. `express.json()` — request body parsing
3. `/api` → `apiRouter` (`src/api/routes/index.ts`, mounts `health` at `/api/health` and the
   feature routers at `/api/clients`, `/api/plans` and `/api/invoices`)
4. `/api` → `notFoundHandler` again, so an unknown `/api/*` path returns **JSON 404** instead of
   falling through and being answered with the SPA's HTML
5. `express.static(config.uiDir, { index: false })` — hashed assets from `dist/ui`
6. `spaFallback` — GET/HEAD only, serves `dist/ui/index.html` so client-side routes work
7. `notFoundHandler` — anything left (e.g. a POST to an unknown path) is a JSON 404
8. `errorHandler` — must keep all four params; Express detects error handlers by arity. It first
   answers the expected errors that routes and services throw (`RequestValidationError` → 400,
   `AppError` → its kind's status; see Feature modules). That check must stay **before** the next
   one: errors carrying a 4xx `status` (malformed JSON → 400, oversized body → 413 from
   `express.json()`) are answered with that status and a fixed message, which would swallow the
   message of any other error that happened to have a `status`. Everything else is a 500

The production image sets `NODE_ENV=production`, so its CSP includes `upgrade-insecure-requests`.
That is correct behind TLS. Over plain HTTP it breaks the page wherever the browser upgrades the
asset requests to https: Safari does this even on `localhost`, and every browser does it for a LAN
IP or hostname. Chrome and Firefox leave `http://localhost` alone. To test the container over plain
HTTP, run it with `-e NODE_ENV=development`.

`spaFallback` deliberately calls `next()` when `dist/ui/index.html` is missing. That is the
`dev:api`-without-a-build case, where Vite serves the UI and a 404 is the honest answer.

### Feature modules (`src/api/feature/<name>/`)

Each feature folder holds:

- `<name>.router.ts` — **HTTP only**: parse params, query, body and headers with `parseOrThrow`,
  call the service, choose the status and response shape. No business rules, no `try/catch`.
- `<name>.service.ts` — the **business rules**. Plain exported functions that take parsed values
  and return records, or throw `AppError`. They never import express.
- `<name>.schema.ts` — zod schemas and the `z.infer` types.
- `<name>.storage.ts` — data access. Storage is an in-memory mock array, run through the record
  schema at import so bad mock data fails at boot. Writes replace records in that array, so they
  last until the process restarts. The invoice feature has `invoice.oncade.ts` in its place.

Imports run one way: a router imports only its own service; a service imports its own storage (or
Oncade client) and **other features' services**, never their storage. Routers import services as a
namespace (`import * as planService from './plan.service.ts'`), because a service and its storage
often share function names. Services expose `getX` (throws `not-found`) for the feature's own
routes and `findX` (returns `undefined`) for other features, which decide what a missing reference
means to them (an unknown `planId` in a client PATCH is a 400, not a 404). The one exception to the
import rule is `client.storage.ts` → `plan.storage.ts`, the boot check on mock data.

Expected failures are **thrown**, and Express 5 forwards them from sync and async handlers alike to
`errorHandler`. Both classes live in `src/api/lib/errors.ts`:

- `parseOrThrow(schema, value)` throws `RequestValidationError` → `sendValidationError`.
- Services throw `AppError(kind, message, { field? })`, which `sendAppError` answers with:
  - `invalid` → 400
  - `not-found` → 404, with no `details`
  - `conflict` → 409
  - `rejected` → 422
  - `upstream` → 502
  - `unavailable` → 503

  With a `field`, a 400 or 409 also gets `details: { [field]: [message] }`. `AppError`
  deliberately has no `status` property; see `errorHandler` above.

Shared response helpers live in `src/api/lib/http.ts`. Bad input → 400
`{ error, message?, details: fieldErrors }`. `message` is there only for errors on the whole body,
such as an unknown key or a body that isn't an object. Write bodies are `z.strictObject`, so an
unknown key is a 400 rather than silently dropped; query strings still strip unknown keys. An
unknown id → 404.

- **`client`**: `GET /api/clients?search=&status=&planId=` → `{ data, total }` (newest first;
  `search` matches name/email case-insensitively; `planId=none` means no plan).
  `GET /api/clients/:id` → `{ data }`. `PATCH /api/clients/:id { planId: uuid | null }` attaches or
  detaches a plan. An unknown plan → 400; attaching an **archived** plan → 409, unless it is already
  that client's plan (re-sending it is a no-op). It is the only writable client field.
- **`plan`**: `GET /api/plans?archived=true|false` → `{ data, total }` (active before archived, then
  cheapest monthly first, custom pricing last). `GET /api/plans/:id`. `POST /api/plans` → 201.
  `PATCH /api/plans/:id` (partial; an empty body → 400; `prices` is replaced whole). Prices are
  **integers in the currency's minor unit** (cents), with `null` meaning custom/contact-sales;
  both prices are set or both are `null`. `currency` must be `USD`, because plans are invoiced
  through Oncade, which bills in USD only (`src/api/feature/invoice/oncade-invoices.md`).
  `code` (`lite`, `pro`, …) is unique (duplicate → 409) and cannot change after creation. Plans are
  never deleted; `archived: true` keeps them on existing clients but blocks new attachments.
  `client.service.ts` uses `plan.service.ts` to vet a `planId`, and `client.storage.ts` imports plan
  storage to check mock `planId`s at boot, so the dependency runs client → plan only. An empty
  PATCH body is rejected by a `.refine` on `updatePlanSchema`, whose `when` keeps it from piling
  onto an "Unrecognized key" error.
- **`invoice`** (phase 1, design notes in `src/api/feature/invoice/oncade-invoices.md`): there is
  **no storage file**, because **Oncade is the source of truth**. `invoice.oncade.ts` is the
  outbound client: native `fetch`, 15 s timeout, `redirect: 'error'`, and a lenient
  `z.looseObject` parse, since Oncade documents its response only partly. Only `_id` and `status`
  are required. Every failure becomes an `OncadeError` with a `kind`. `invoice.service.ts` turns
  those into `AppError`s (in `callOncade`), looks up the client for a new invoice, filters and sorts
  lists, and owns the refetch-after-send/cancel rule. Each invoice we create carries
  `externalMetadata { source, clientId, planId }`; per-client lists fetch Oncade's list (up to 10
  pages of 100) and filter on it. Money is **cents in our API**, converted to Oncade's dollars only
  in `invoice.oncade.ts`.
  - `GET /api/invoices/config` → `{ data: { configured, environment } }`. It always works. Every
    other route answers **503** when `config.oncade` is unset; that check runs before validation.
    It is the `requireOncade` middleware added to each route, not `invoiceRouter.use()`, which
    would also turn unknown paths under `/api/invoices` into 503s instead of 404s.
  - `GET /api/invoices?status=&clientId=` → `{ data, total }`, newest first.
  - `GET /api/invoices/:id` → `{ data }`. Ids must match `[A-Za-z0-9_-]{1,64}`, because they go
    into the outbound URL.
  - `POST /api/invoices` → 201. It always creates a **draft**: nothing is emailed until the invoice
    is sent.
  - `POST /api/invoices/:id/send` and `POST /api/invoices/:id/cancel` → `{ data }`, re-fetched.
  - All three writes **require an `Idempotency-Key` UUID header**, which is forwarded to Oncade.
  - **The recipient always comes from the client record** (`company`, `email`), never from the
    body, so the open endpoint cannot email arbitrary addresses.
  - **Send and cancel count as done once Oncade accepts the POST.** If the follow-up re-fetch
    fails, the route still answers 200 with `{ data: null, message }`, and the UI calls the hook's
    `reload()`. Answering with an error would make the admin retry, then likely cancel and recreate,
    emailing the client twice. After a failed action the UI also reloads, so it shows Oncade's real
    status.
  - The open reads return **every** invoice of the Oncade business, including ones made in the
    Oncade dashboard for people who aren't clients here. Put them behind auth first when it lands.
  - Drafts are deliberately **not editable**: Oncade fixes fees at creation, so the UI says to cancel
    and recreate.
  - Oncade failures map as follows: other 4xx → **422** with Oncade's message; 401, 403, 5xx,
    network failure or an unparseable body → **502**; 404 → 404 "Invoice not found". The mapping
    is `toAppError` in `invoice.service.ts`.

**The write endpoints have no auth.** This was a deliberate decision: they stay open until an
auth layer is built, and that work should put them behind it.

The UI imports the API's types with `import type` from the `*.schema.ts` files. This keeps one source of
truth, and the import is erased at build so zod never reaches the bundle. Never turn it into a value
import.

### Config (`src/api/config.ts`)

No variable is required: the server boots with an empty environment. There is no auth yet, and no
auth secret in config either; the old `ADMIN_PASS` placeholder was dropped on purpose, so the auth
work will add whatever it needs. `config.oncade` is **optional**: it is `undefined` when `ONCADE_API_KEY` and `ONCADE_BUSINESS_ID`
are both unset or blank, so the server boots without Oncade. Setting only one of them, a key without
the `oncade_platform_test_`/`oncade_platform_live_` prefix (the prefix sets `environment`), or a
non-https `ONCADE_API_URL` (default `https://www.oncade.gg`) throws at boot. The invoice module
answers 503 "Oncade is not configured" when it is `undefined`. Never log `config` whole: it holds the API key.
`uiDir` resolves against `process.cwd()`, which is why `npm start` must run from the repo root
(and why the Docker image sets `WORKDIR /app`). Override with `UI_DIST_DIR`.

Env comes from Node's built-in `--env-file-if-exists=.env` — there is no `dotenv` dependency, and
the `if-exists` variant matters because the Docker image has no `.env` and gets real env vars instead.

### TypeScript layout

Four configs, because the two halves need different libs and module modes:

- `tsconfig.base.json` — shared strictness (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, …)
- `tsconfig.api.json` — `nodenext`, `types: ["node"]`, emits to `dist/api`
- `tsconfig.ui.json` — `preserve`/`bundler`, DOM libs, `jsx: react-jsx`, `noEmit`
- `tsconfig.test.json` — like the api config but `noEmit`, over `test/**/*.ts`; tests never reach
  `dist/` or the Docker image (`.dockerignore` drops `test/`)

Relative imports inside `src/api` are written with **`.ts` extensions** (`./config.ts`). This is
intentional: `allowImportingTsExtensions` + `rewriteRelativeImportExtensions` let Node run the
sources directly during `dev:api` while `tsc` rewrites them to `.js` on build. Do not "correct" them
to `.js` — that breaks the dev server.

### UI

Vite's `root` is `src/ui`, so `build.outDir` is written as `../../dist/ui` (relative to root) and
`index.html` references `/main.tsx`. React 19 ships no bundled types; `@types/react` is a real dependency.

Routing is **react-router v8 in declarative mode** (`BrowserRouter` in `main.tsx`, `<Routes>` in
`App.tsx`): `/` redirects to `/clients`, then `/clients`, `/clients/:id` (with its invoices),
`/clients/:id/invoices/new` (form prefilled from the client's plan), `/plans`, `/plans/new`,
`/plans/:id` (the plan edit form, plus the clients on that plan), `/invoices` and `/invoices/:id`
(Send and Cancel, each a two-click confirm whose second step ignores the second click of a
double-click). Deep links work in
production because of Express's `spaFallback`. Pages live in `src/ui/feature/<name>/`. Data is
loaded with `useFetchJson` (`src/ui/lib/api.ts`), which aborts superseded requests and keeps the
previous data while a new URL loads. Writes go through `sendJson`; pages feed the returned record
into the hook's `mutate` instead of refetching. A failed request throws `ApiError`, whose `details`
holds the API's per-field messages for inline form errors. Prices (plans and invoice lines) are
typed in major units and converted to minor units by string parsing in `src/ui/lib/money.ts`, not
`* 100`, so 19.99 stays exactly 1999. `sendJson` takes extra headers; invoice writes pass
`newIdempotencyKey()`, which falls back to `getRandomValues` where `crypto.randomUUID` is missing
(plain-HTTP LAN access). Page titles use React 19's hoisted `<title>` element.

The router wraps location updates in `startTransition` by default, so **never bind a text
`<input>`'s `value` straight to `useSearchParams`**: keystrokes get dropped. `ClientListPage` keeps
the search text in local state, writes it to the URL with a `location.state` marker, and copies the
URL value back on navigations without that marker, and always on back/forward (`POP`), because
history keeps `location.state` and restores the marker.

## Testing

API only, with Node's built-in `node:test` and `node:assert/strict`; HTTP tests use `supertest`
against `createApp()` (no port is opened). Node runs the `.ts` files directly, like `dev:api`.
Coverage is `c8` (`.c8rc.json`): all of `src/api` except `server.ts`, reporters `text-summary` and
`html`, and **no thresholds** for now. There is no UI test setup.

```
test/
  helpers/   env.ts (setTestEnv, loadApp), oncade.ts (mockOncade, oncadeInvoice, ONCADE),
             fixtures.ts (mock plan/client ids), console.ts (captureConsole)
  unit/      config, lib/http, middleware/error-handler, each service, invoice.oncade
  api/       one file per router, plus app (production) and development-mode checks
```

Production code has **no test seams**, and the tests rely on that staying workable:

- **One process per file** (`--test-isolation=process`, set explicitly in the script). `config` is
  read once, at import, so a file calls `setTestEnv({...})` / `loadApp({...})` **before** importing
  anything that reaches `config.ts`, then uses `await import(...)`. Static imports are hoisted and
  would load config first. Needing a different environment (Oncade on vs off, production vs
  development) means a separate file. `setTestEnv` sets or deletes every variable config reads, so
  the shell's environment never leaks in, and tests never load `.env`.
- `config.test.ts` re-evaluates config per case by importing `config.ts?load=N` (a new module URL).
- **Oncade is stubbed by mocking `fetch`** with `mockOncade(t, { 'GET /invoices/inv_1': reply })`,
  keyed on the path below `/api/v1/platform`. A request it does not expect fails the test when it
  ends, so no test can reach the network. supertest uses `node:http`, not `fetch`, so it is not
  affected. Do not reach for `mock.module` (experimental flag) unless this stops being enough.
- **In-memory storage is shared by the tests in a file.** Create plans with `uniquePlanCode()`,
  restore any client whose plan you change, and assert on known ids rather than list counts.
- `captureConsole()` silences and records `console.error`/`warn`; Oncade tests use it to check the
  API key and client PII never reach a log line.

## Docker

Single multi-stage `Dockerfile` → one container serving API and UI on :3000 (~191MB). Stages:
`deps` (full install) → `build` (npm run build) → `prod-deps` (`npm ci --omit=dev`) → `runner`,
which copies only `dist/` plus production `node_modules` and runs as the `node` user.

No secrets are baked into the image. The Oncade variables are passed at run time; without them the
container boots and the invoice routes answer 503:

```
docker build -t saas-admin-panel .
docker run -p 3000:3000 saas-admin-panel
docker run -e ONCADE_API_KEY=... -e ONCADE_BUSINESS_ID=... -p 3000:3000 saas-admin-panel
```

`HEALTHCHECK` polls `/api/health` with `node -e fetch(...)` — no curl in the Alpine image.

## Secrets: `.env` is off-limits

`.env` (and every `.env.*` except `.env.example`) holds real secrets and is **deliberately blocked**
for Claude Code. Do not try to read, grep, source, copy or edit it, and do not try to work around
the block (scripts, symlinks, alternate commands). Read `.env.example` for the variable names; if a
real value is needed, ask the user.

Two layers enforce this, both in `.claude/settings.json`:

- `permissions.deny` — `Read(...)`/`Edit(...)` rules for `.env` and the usual variants. They are
  listed explicitly because deny beats allow, so a `.env.*` deny would also hide `.env.example`.
- `PreToolUse` hook `.claude/hooks/block-env.mjs` — checks file tools (resolving symlinks), Grep/Glob
  paths and globs, and Bash command text, then exits 2 to block. It fails closed on unparseable input.

Both are guardrails, not a security boundary: neither stops a subprocess that opens the file itself.
OS-level enforcement would need `sandbox.filesystem.denyRead`, which is intentionally not enabled
because `dev:api`/`start` load `.env` via `--env-file-if-exists` and would break under the sandbox.

## Code review

- **`code-reviewer` subagent** (`.claude/agents/code-reviewer.md`): a read-only reviewer for pending
  changes. By default it reviews the diff against `main` plus uncommitted and untracked files; it can
  also take a range or a PR number. It runs a correctness pass and a security pass and reports
  verified findings with `file:line`. It never edits files. Its description says "use proactively",
  so Claude may delegate to it after making changes; you can also ask for it explicitly.
- **`appsec-review` skill** (`.claude/skills/appsec-review/SKILL.md`): the security checklist,
  severity scale, exclusions and report format, written for this app. The subagent preloads it
  through its `skills:` field, and you can run it directly as `/appsec-review`. Do not add
  `disable-model-invocation: true` to it, because that stops it being preloaded. Do not rename it to
  `security-review` or `code-review`; those names belong to built-in skills.

When the app changes shape (auth middleware lands, a database is added, new env vars), update the
"How this app is put together" section and the exclusions in the skill so the reviewer stays accurate.

## Editing conventions

`.claude/settings.json` registers a PostToolUse hook running `prettier --write` on each file after
Write/Edit, so formatting is applied for you. The hook only loads once Claude Code reloads its
config (open `/hooks` or restart) — `.claude/` did not exist when it was created.

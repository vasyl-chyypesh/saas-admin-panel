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
| `npm run typecheck`               | `tsc --noEmit` against both the api and ui tsconfigs                  |
| `npm run lint` / `lint:fix`       | oxlint (`--fix` to autofix)                                           |
| `npm run format` / `format:check` | Prettier write / check                                                |
| `npm run update:deps`             | `npx npm-check-updates`                                               |

There is no test runner wired up yet.

## Linting: oxlint, not ESLint

The linter is **oxlint** (`.oxlintrc.json`), and this is not an arbitrary preference — do not
"restore" ESLint here. `typescript-eslint` enforces `"typescript": ">=4.8.4 <6.1.0"` with a runtime
guard, so it throws outright against this project's `typescript@7.0.2` (the native Go port). An npm
`overrides` entry silences the install-time peer error but cannot satisfy the runtime guard, and
scoping the override to the `@typescript-eslint/*` packages still leaves npm rejecting the root peer
conflict. oxlint parses TypeScript itself and declares no `typescript` peer at all, so the latest
compiler and a working linter coexist. (Upstream: `typescript-eslint#10940`, targeting TS ≥ 7.1.)

Two rules are switched off in `.oxlintrc.json` for real reasons, not to paper over findings:

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
   feature routers at `/api/clients` and `/api/plans`)
4. `/api` → `notFoundHandler` again, so an unknown `/api/*` path returns **JSON 404** instead of
   falling through and being answered with the SPA's HTML
5. `express.static(config.uiDir, { index: false })` — hashed assets from `dist/ui`
6. `spaFallback` — GET/HEAD only, serves `dist/ui/index.html` so client-side routes work
7. `notFoundHandler` — anything left (e.g. a POST to an unknown path) is a JSON 404
8. `errorHandler` — must keep all four params; Express detects error handlers by arity. Errors
   carrying a 4xx `status` (malformed JSON → 400, oversized body → 413 from `express.json()`) are
   answered with that status and a fixed message; everything else is a 500

The production image sets `NODE_ENV=production`, so its CSP includes `upgrade-insecure-requests`.
That is correct behind TLS. Over plain HTTP it breaks the page wherever the browser upgrades the
asset requests to https: Safari does this even on `localhost`, and every browser does it for a LAN
IP or hostname. Chrome and Firefox leave `http://localhost` alone. To test the container over plain
HTTP, run it with `-e NODE_ENV=development`.

`spaFallback` deliberately calls `next()` when `dist/ui/index.html` is missing. That is the
`dev:api`-without-a-build case, where Vite serves the UI and a 404 is the honest answer.

### Feature modules (`src/api/feature/<name>/`)

Each feature folder holds `<name>.router.ts` (Express router), `<name>.schema.ts` (zod schemas and
the `z.infer` types) and `<name>.storage.ts` (data access). Storage is an in-memory mock array, run
through the record schema at import so bad mock data fails at boot. Writes replace records in that
array, so they last until the process restarts.

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
  both prices are set or both are `null`. A `PATCH` that changes `currency` must also send `prices`,
  since the stored integers have no scale of their own.
  `code` (`lite`, `pro`, …) is unique (duplicate → 409) and cannot change after creation. Plans are
  never deleted; `archived: true` keeps them on existing clients but blocks new attachments.
  `client.storage.ts` imports plan storage to check mock `planId`s at boot, so the dependency runs
  client → plan only.

**The write endpoints have no auth.** This was a deliberate decision: they stay open until an
auth layer is built, and that work should put them behind it.

The UI imports the API's types with `import type` from `client.schema.ts`. This keeps one source of
truth, and the import is erased at build so zod never reaches the bundle. Never turn it into a value
import.

### Config (`src/api/config.ts`)

`ADMIN_PASS` is validated at import time and **throws if unset or empty**, so the server refuses to
boot without it. Nothing consumes it yet — no auth middleware exists; it is a deliberate placeholder.
`uiDir` resolves against `process.cwd()`, which is why `npm start` must run from the repo root
(and why the Docker image sets `WORKDIR /app`). Override with `UI_DIST_DIR`.

Env comes from Node's built-in `--env-file-if-exists=.env` — there is no `dotenv` dependency, and
the `if-exists` variant matters because the Docker image has no `.env` and gets real env vars instead.

### TypeScript layout

Three configs, because the two halves need different libs and module modes:

- `tsconfig.base.json` — shared strictness (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, …)
- `tsconfig.api.json` — `nodenext`, `types: ["node"]`, emits to `dist/api`
- `tsconfig.ui.json` — `preserve`/`bundler`, DOM libs, `jsx: react-jsx`, `noEmit`

Relative imports inside `src/api` are written with **`.ts` extensions** (`./config.ts`). This is
intentional: `allowImportingTsExtensions` + `rewriteRelativeImportExtensions` let Node run the
sources directly during `dev:api` while `tsc` rewrites them to `.js` on build. Do not "correct" them
to `.js` — that breaks the dev server.

### UI

Vite's `root` is `src/ui`, so `build.outDir` is written as `../../dist/ui` (relative to root) and
`index.html` references `/main.tsx`. React 19 ships no bundled types; `@types/react` is a real dependency.

Routing is **react-router v8 in declarative mode** (`BrowserRouter` in `main.tsx`, `<Routes>` in
`App.tsx`): `/` redirects to `/clients`, then `/clients`, `/clients/:id`, `/plans`, `/plans/new` and
`/plans/:id` (the plan edit form, plus the clients on that plan). Deep links work in
production because of Express's `spaFallback`. Pages live in `src/ui/feature/<name>/`. Data is
loaded with `useFetchJson` (`src/ui/lib/api.ts`), which aborts superseded requests and keeps the
previous data while a new URL loads. Writes go through `sendJson`; pages feed the returned record
into the hook's `mutate` instead of refetching. A failed request throws `ApiError`, whose `details`
holds the API's per-field messages for inline form errors. Plan prices are typed in major units and
converted to minor units by string parsing, not `* 100`, so 19.99 stays exactly 1999. Page titles use React 19's hoisted `<title>` element.

The router wraps location updates in `startTransition` by default, so **never bind a text
`<input>`'s `value` straight to `useSearchParams`**: keystrokes get dropped. `ClientListPage` keeps
the search text in local state, writes it to the URL with a `location.state` marker, and copies the
URL value back on navigations without that marker, and always on back/forward (`POP`), because
history keeps `location.state` and restores the marker.

## Docker

Single multi-stage `Dockerfile` → one container serving API and UI on :3000 (~191MB). Stages:
`deps` (full install) → `build` (npm run build) → `prod-deps` (`npm ci --omit=dev`) → `runner`,
which copies only `dist/` plus production `node_modules` and runs as the `node` user.

`ADMIN_PASS` is **not** baked into the image; the container exits at boot without it:

```
docker build -t saas-admin-panel .
docker run -e ADMIN_PASS=secret -p 3000:3000 saas-admin-panel
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

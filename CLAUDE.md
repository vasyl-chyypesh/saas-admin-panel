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
3. `/api` → `apiRouter` (`src/api/routes/index.ts`, mounts `health` at `/api/health`)
4. `/api` → `notFoundHandler` again, so an unknown `/api/*` path returns **JSON 404** instead of
   falling through and being answered with the SPA's HTML
5. `express.static(config.uiDir, { index: false })` — hashed assets from `dist/ui`
6. `spaFallback` — GET/HEAD only, serves `dist/ui/index.html` so client-side routes work
7. `notFoundHandler` — anything left (e.g. a POST to an unknown path) is a JSON 404
8. `errorHandler` — must keep all four params; Express detects error handlers by arity

The production image sets `NODE_ENV=production`, so its CSP includes `upgrade-insecure-requests`.
That is correct behind TLS. Over plain HTTP it breaks the page wherever the browser upgrades the
asset requests to https: Safari does this even on `localhost`, and every browser does it for a LAN
IP or hostname. Chrome and Firefox leave `http://localhost` alone. To test the container over plain
HTTP, run it with `-e NODE_ENV=development`.

`spaFallback` deliberately calls `next()` when `dist/ui/index.html` is missing. That is the
`dev:api`-without-a-build case, where Vite serves the UI and a 404 is the honest answer.

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
`index.html` references `/main.tsx`. `App.tsx` is an intentional placeholder rendering the single
word "development". React 19 ships no bundled types; `@types/react` is a real dependency.

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

## Editing conventions

`.claude/settings.json` registers a PostToolUse hook running `prettier --write` on each file after
Write/Edit, so formatting is applied for you. The hook only loads once Claude Code reloads its
config (open `/hooks` or restart) — `.claude/` did not exist when it was created.

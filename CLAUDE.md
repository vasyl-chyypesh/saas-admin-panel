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
| `npm run lint`                    | ESLint — **currently broken, see Known issue below**                  |
| `npm run format` / `format:check` | Prettier write / check                                                |
| `npm run update:deps`             | `npx npm-check-updates`                                               |

There is no test runner wired up yet.

## Known issue: lint does not run

`npm run lint` fails with `typescript-eslint does not support TS 7.0`. This is deliberate, not a
misconfiguration to "fix" by guessing:

- The project uses `typescript@7.0.2` (the native Go port, current `latest`).
- `typescript-eslint@8.73.0` declares `"typescript": ">=4.8.4 <6.1.0"` **and enforces it with a
  runtime guard**, so it throws before linting anything.
- `"overrides": { "typescript": "7.0.2" }` in `package.json` exists only to stop npm's peer-conflict
  error at install time. It cannot satisfy the runtime guard — scoping the override to the
  `@typescript-eslint/*` packages was tried and npm still rejects the root peer conflict.

Upstream tracking: `typescript-eslint#10940` (support targeted at TS ≥ 7.1). Until that lands the
real options are: pin `typescript` to `6.0.3` (inside the supported range), or replace ESLint with a
linter that parses TS itself (e.g. oxlint). Prettier and `tsc` are unaffected and both pass.

## Architecture

### Request pipeline (`src/api/app.ts`)

Middleware order is load-bearing — `createApp()` registers, in sequence:

1. `/api` → `apiRouter` (`src/api/routes/index.ts`, mounts `health` at `/api/health`)
2. `/api` → `notFoundHandler` again, so an unknown `/api/*` path returns **JSON 404** instead of
   falling through and being answered with the SPA's HTML
3. `express.static(config.uiDir, { index: false })` — hashed assets from `dist/ui`
4. `spaFallback` — GET/HEAD only, serves `dist/ui/index.html` so client-side routes work
5. `notFoundHandler` — anything left (e.g. a POST to an unknown path) is a JSON 404
6. `errorHandler` — must keep all four params; Express detects error handlers by arity

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

## Editing conventions

`.claude/settings.json` registers a PostToolUse hook running `prettier --write` on each file after
Write/Edit, so formatting is applied for you. The hook only loads once Claude Code reloads its
config (open `/hooks` or restart) — `.claude/` did not exist when it was created.

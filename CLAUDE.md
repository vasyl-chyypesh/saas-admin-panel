# CLAUDE.md

<!--
Keep this file under ~100 lines: it loads into every session. Area-specific guidance lives in
.claude/rules/*.md with `paths:` frontmatter and loads only when matching files are opened.
Human-facing docs (Docker, plain-HTTP testing, the .env guardrails) live in README.md.
-->

Express 5 JSON API + React 19 UI in **one npm package** (no workspaces, one lockfile). In
production Express serves the built UI, so the app is one process on :3000.

## Commands

- `npm run dev`: API on :3000 (`node --watch`) + Vite on :5173 proxying `/api` (POSIX shells only)
- `npm test`: all API tests. One file: `node --test test/api/plans.api.test.ts`
- `npm run typecheck` (api, ui and test tsconfigs) · `npm run lint` (oxlint) · `npm run format:check`
- `npm run scan:security`: Bearer SAST in Docker, same severities as CI · `npm run check:deps`:
  list outdated deps (read-only)
- Prettier runs automatically after every Write/Edit (PostToolUse hook in `.claude/settings.json`).

## Rules that apply everywhere

- Relative imports in `src/api` use **`.ts` extensions** (`./config.ts`). Don't "fix" them to
  `.js`: Node runs the sources directly in dev, and tsc rewrites them on build.
- The UI imports API types with `import type` from `*.schema.ts`. Never make it a value import
  (zod would reach the bundle).
- The linter is **oxlint**. Don't add ESLint: typescript-eslint rejects this project's TypeScript 7
  at runtime (typescript-eslint#10940). The rule exceptions in `.oxlintrc.json` are deliberate.
- **The write endpoints have no auth on purpose**, until an auth layer is built. That work should
  put them, and the invoice reads, behind it.
- Never log `config` whole: it holds the Oncade API key.
- Env comes from `node --env-file-if-exists=.env`. Don't add dotenv. No variable is required.
- Money is **integer cents** in the API. The UI converts by string parsing in
  `src/ui/lib/money.ts`, never `* 100`.

## Architecture

- `src/api/app.ts`: the middleware order is load-bearing (helmet first, `/api` JSON 404 before
  static + SPA fallback, `errorHandler` last with four params). Read its comments before reordering.
- `src/api/feature/<name>/`: router (HTTP only) → service (business rules, throws `AppError`) →
  storage (in-memory mock array). A service may call other features' services, never their storage.
- Features: `client`, `plan`, `invoice`. Invoices have no storage: Oncade is the source of truth
  (`src/api/feature/invoice/oncade-invoices.md`).
- UI: Vite `root` is `src/ui`, pages in `src/ui/feature/<name>/`, react-router in declarative mode.
- Tests cover the API only (`node:test` + supertest); there is no UI test setup.

Area details load from `.claude/rules/` (api, invoices, ui, testing, runtime) when you open
matching files.

## Secrets

Never read, grep, copy or edit `.env` or `.env.*` (except `.env.example`), and don't work around
the block hook. `.env.example` lists the variable names; ask the user for real values.

## Maintenance

When the app changes shape (auth, a database, new env vars), update `.claude/rules/` and the "How
this app is put together" section of `.claude/skills/appsec-review/SKILL.md`.

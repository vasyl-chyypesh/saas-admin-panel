# saas-admin-panel

A test project: a micro SaaS admin panel with an Express 5 JSON API and a React 19 UI in one npm
package (no workspaces, one lockfile). In production Express serves the built UI, so the whole app
is one process on one port.

## Prerequisites

- **Node.js 26 or newer**, the same as the Docker image. The dev server runs the TypeScript sources
  directly through Node's built-in type stripping.
- npm (comes with Node).
- A POSIX shell (macOS, Linux, WSL, Git Bash) for `npm run dev`. On plain Windows, see below.
- Optional: Docker, to build the production image.

## Quick start

```sh
npm install
cp .env.example .env   # optional: only needed for Oncade invoices
npm run dev            # API on :3000 (node --watch) + Vite on :5173
```

Then open **http://localhost:5173**. Vite serves the UI and proxies `/api` to the API on :3000.
Don't open :3000 in dev: without a build it serves only the API, so UI pages return 404. To check
the API on its own:

```sh
curl http://localhost:3000/api/health
```

On Windows without a POSIX shell, `npm run dev` doesn't work (it uses `&`). Run the two halves in
separate terminals: `npm run dev:api` and `npm run dev:ui`.

### Data is in-memory mock data

There is no database yet. Clients and plans are seed arrays in `src/api/feature/*/*.storage.ts`,
checked when the app starts. Edits change those arrays, so they last only until the API restarts,
and `node --watch` restarts it on every file save. Invoices are the exception: Oncade stores them
(see below).

### Invoices (Oncade)

No environment variable is required. Without Oncade credentials the app runs normally and the
invoice routes answer `503`. To enable invoices, set **both** variables in `.env`:

- `ONCADE_API_KEY` must be a **platform** key. Its prefix decides where invoices go:
  `oncade_platform_test_...` creates test invoices, `oncade_platform_live_...` creates real ones.
  **Use a test key in development.**
- `ONCADE_BUSINESS_ID` is the Oncade business that all invoices belong to.

Setting only one of the two, using a key that isn't a platform key, or an `ONCADE_API_URL` that
isn't `https://` stops the server at startup with an error that names the variable. Integration
details are in `src/api/feature/invoice/oncade-invoices.md`.

## Environment variables

Loaded from `.env` by `node --env-file-if-exists=.env` (no dotenv). `.env.example` is the
template.

| Variable             | Default                 | Notes                                                                 |
| -------------------- | ----------------------- | --------------------------------------------------------------------- |
| `PORT`               | `3000`                  | Port Express listens on                                               |
| `NODE_ENV`           | `development`           | `production` adds `upgrade-insecure-requests` to the CSP (see Docker) |
| `ONCADE_API_KEY`     | unset                   | Optional. Set together with `ONCADE_BUSINESS_ID`                      |
| `ONCADE_BUSINESS_ID` | unset                   | Optional. Set together with `ONCADE_API_KEY`                          |
| `ONCADE_API_URL`     | `https://www.oncade.gg` | Must be `https://`                                                    |
| `UI_DIST_DIR`        | `dist/ui`               | Built UI directory, resolved against the current working directory    |

## Scripts

| Command                           | What it does                                                       |
| --------------------------------- | ------------------------------------------------------------------ |
| `npm run dev`                     | `dev:api` and `dev:ui` together (uses `&`, so POSIX shells only)   |
| `npm run dev:api` / `dev:ui`      | The API with `node --watch` / the Vite dev server                  |
| `npm run build`                   | Vite → `dist/ui`, then tsc → `dist/api`                            |
| `npm start`                       | Runs `dist/api/server.js`; run it from the repo root               |
| `npm test` / `test:coverage`      | API tests with `node:test`; coverage HTML in `coverage/index.html` |
| `npm run typecheck`               | `tsc --noEmit` over the api, ui and test tsconfigs                 |
| `npm run lint` / `lint:fix`       | oxlint                                                             |
| `npm run format` / `format:check` | Prettier                                                           |
| `npm run update:deps`             | `npx npm-check-updates`                                            |

### Running the production build locally

```sh
npm run build
npm start              # http://localhost:3000 serves the UI and the API
```

`NODE_ENV` defaults to `development` when unset, which is what you want over plain HTTP on
localhost.

## Project layout

```
src/
  api/
    server.ts            entry point (listen)
    app.ts               middleware order matters: read its comments before reordering
    config.ts            reads and validates env vars once, at import
    routes/              /api router and /api/health
    middleware/          error handler, JSON 404, SPA fallback
    feature/<name>/      client, plan, invoice
      *.router.ts        HTTP only: parse, call the service, respond
      *.service.ts       business rules; throws AppError
      *.storage.ts       in-memory mock data (invoices have none: Oncade stores them)
      *.schema.ts        zod schemas and types, shared with the UI as types only
  ui/                    Vite root: index.html, main.tsx, App.tsx (routes)
    feature/<name>/      pages per feature
    lib/                 api client, money helpers
test/
  api/                   supertest tests against the Express app
  unit/                  services, config, middleware
  helpers/               env setup, fixtures, Oncade fake
```

### API

| Endpoint                            | Methods          | Notes                                                     |
| ----------------------------------- | ---------------- | --------------------------------------------------------- |
| `/api/health`                       | GET              |                                                           |
| `/api/clients`, `/:id`              | GET, PATCH       |                                                           |
| `/api/plans`, `/:id`                | GET, POST, PATCH |                                                           |
| `/api/invoices/config`              | GET              | Whether Oncade is configured, and test or live mode       |
| `/api/invoices`, `/:id`             | GET, POST        | Needs Oncade; POST needs an `Idempotency-Key` UUID header |
| `/api/invoices/:id/send`, `/cancel` | POST             | Needs Oncade and an `Idempotency-Key` header              |

Unknown `/api/*` paths return a JSON 404. Every other path falls through to the UI.

## Conventions

- **Relative imports in `src/api` end in `.ts`** (`./config.ts`). This is deliberate: Node runs the
  sources directly in dev, and tsc rewrites the extensions to `.js` on build. Don't change them.
- **Money is integer cents** in the API. The UI converts with string parsing in
  `src/ui/lib/money.ts`, never `* 100`.
- **The UI imports API types with `import type`** from `*.schema.ts`. A value import would put zod
  in the browser bundle.
- A service may call another feature's service, never its storage.
- The linter is oxlint, not ESLint (see [why](#linting-why-oxlint-not-eslint)).

More detail for each area is in `CLAUDE.md` and `.claude/rules/*.md`.

## Testing

Only the API has tests. `node:test` runs them with supertest, each file in its own process. They
set their own env and use a fake Oncade, so they never read `.env` or call the real API.

```sh
npm test                                     # everything
node --test test/api/plans.api.test.ts       # one file
npm run test:coverage                        # + coverage/index.html
```

There is no CI yet. Before pushing, run:

```sh
npm run typecheck && npm run lint && npm run format:check && npm test
```

## Docker

One multi-stage `Dockerfile` builds a single container serving the API and UI on :3000. No secrets
are baked in; pass the Oncade variables at run time.

```sh
docker build -t saas-admin-panel .
docker run -p 3000:3000 saas-admin-panel
docker run -e ONCADE_API_KEY=... -e ONCADE_BUSINESS_ID=... -p 3000:3000 saas-admin-panel
```

The container has a `HEALTHCHECK` on `/api/health`.

### Plain HTTP and `NODE_ENV`

The image sets `NODE_ENV=production`, so its Content Security Policy includes
`upgrade-insecure-requests`. That is correct behind TLS, but over plain HTTP the page breaks
wherever the browser upgrades asset requests to https: Safari does this even on `localhost`, and
every browser does it for a LAN IP or hostname. To test the container over plain HTTP, run it with
`-e NODE_ENV=development`.

`NODE_ENV` defaults to `development` when unset, so deploys outside Docker must set
`NODE_ENV=production` explicitly.

## Security notes

- **The write endpoints have no auth yet.** This is deliberate until an auth layer is built. The
  invoice reads also return every invoice of the Oncade business, so put them behind auth too.
- Never log `config` whole: it holds the Oncade API key.
- Never commit `.env`; it holds real credentials.

## Linting: why oxlint, not ESLint

`typescript-eslint` enforces `"typescript": ">=4.8.4 <6.1.0"` with a runtime guard, so it throws
against this project's `typescript@7` (the native Go port). An npm `overrides` entry silences the
install-time peer error but not the runtime guard. oxlint parses TypeScript itself and has no
`typescript` peer, so the latest compiler and a working linter coexist. Upstream:
`typescript-eslint#10940`, targeting TS ≥ 7.1. The rule exceptions are explained in
`.oxlintrc.json`.

## Claude Code setup

Guidance for Claude Code lives in `CLAUDE.md` (always loaded, kept short) and `.claude/rules/*.md`
(loaded only when matching files are opened).

`.env` and every `.env.*` except `.env.example` hold real secrets and are blocked for Claude Code by
two layers in `.claude/settings.json`:

- `permissions.deny`: `Read(...)`/`Edit(...)` rules for `.env` and the usual variants. They are
  listed one by one because deny beats allow, so a `.env.*` deny would also hide `.env.example`.
- A `PreToolUse` hook, `.claude/hooks/block-env.mjs`, checks file tools (resolving symlinks),
  Grep/Glob paths and globs, and Bash command text, then exits 2 to block. It fails closed on
  unparseable input.

Both are guardrails, not a security boundary: neither stops a subprocess that opens the file
itself. OS-level enforcement would need `sandbox.filesystem.denyRead`, which is not enabled because
`dev:api` and `start` load `.env` via `--env-file-if-exists` and would break under the sandbox.

A `PostToolUse` hook runs Prettier on each file Claude writes. For reviews there is a read-only
`code-reviewer` subagent (`.claude/agents/`) and an `appsec-review` skill (`.claude/skills/`).

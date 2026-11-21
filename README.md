# saas-admin-panel

A test project: a micro SaaS admin panel with an Express 5 JSON API and a React 19 UI in one npm
package. In production Express serves the built UI, so the whole app is one process on one port.

## Getting started

```sh
npm install
cp .env.example .env   # optional: Oncade credentials for invoices
npm run dev            # API on :3000, Vite on :5173 (proxies /api)
```

No environment variable is required. Without `ONCADE_API_KEY` and `ONCADE_BUSINESS_ID` the app
boots and the invoice routes answer 503.

| Command                           | What it does                                                       |
| --------------------------------- | ------------------------------------------------------------------ |
| `npm run dev`                     | `dev:api` and `dev:ui` together (uses `&`, so POSIX shells only)   |
| `npm run build`                   | Vite → `dist/ui`, then tsc → `dist/api`                            |
| `npm start`                       | Runs `dist/api/server.js`; run it from the repo root               |
| `npm test` / `test:coverage`      | API tests with `node:test`; coverage HTML in `coverage/index.html` |
| `npm run typecheck`               | `tsc --noEmit` over the api, ui and test tsconfigs                 |
| `npm run lint` / `lint:fix`       | oxlint                                                             |
| `npm run format` / `format:check` | Prettier                                                           |
| `npm run update:deps`             | `npx npm-check-updates`                                            |

## Docker

One multi-stage `Dockerfile` builds a single container serving the API and UI on :3000. No secrets
are baked in; pass the Oncade variables at run time.

```sh
docker build -t saas-admin-panel .
docker run -p 3000:3000 saas-admin-panel
docker run -e ONCADE_API_KEY=... -e ONCADE_BUSINESS_ID=... -p 3000:3000 saas-admin-panel
```

### Plain HTTP and `NODE_ENV`

The image sets `NODE_ENV=production`, so its Content Security Policy includes
`upgrade-insecure-requests`. That is correct behind TLS, but over plain HTTP the page breaks
wherever the browser upgrades asset requests to https: Safari does this even on `localhost`, and
every browser does it for a LAN IP or hostname. To test the container over plain HTTP, run it with
`-e NODE_ENV=development`.

`NODE_ENV` defaults to `development` when unset, so deploys outside Docker must set
`NODE_ENV=production` explicitly.

## Linting: why oxlint, not ESLint

`typescript-eslint` enforces `"typescript": ">=4.8.4 <6.1.0"` with a runtime guard, so it throws
against this project's `typescript@7` (the native Go port). An npm `overrides` entry silences the
install-time peer error but not the runtime guard. oxlint parses TypeScript itself and has no
`typescript` peer, so the latest compiler and a working linter coexist. Upstream:
`typescript-eslint#10940`, targeting TS ≥ 7.1. The rule exceptions are explained in
`.oxlintrc.json`.

## Security notes

- **The write endpoints have no auth yet.** This is deliberate until an auth layer is built. The
  invoice reads also return every invoice of the Oncade business, so put them behind auth too.
- Never log `config` whole: it holds the Oncade API key.

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

---
name: appsec-review
description: Security checklist for reviewing code changes in this Express 5 + React 19 app — injection, authn/authz, secrets, error leakage, XSS, middleware order, headers/CORS, Docker and dependencies. Use when reviewing a diff, branch or PR for security issues.
---

# Application security review

Use this checklist to review a **change** (a diff, branch or PR), not to audit the whole repo.

## Ground rules

- **Review only what changed.** Report a problem in untouched code only when the change makes it
  newly reachable or worse (for example, a new route that exposes an old helper).
- **Never read `.env` or any `.env.*` file except `.env.example`.** They hold real secrets and are
  blocked by a hook. Do not work around the block. `.env.example` lists the variable names.
- **Every finding needs a concrete attack path:** who sends what input, through which code path, to
  get what result. If you cannot write that sentence, do not report the finding.
- **Read beyond the hunk.** Open the surrounding file, the router that mounts it and
  `src/api/app.ts` before concluding anything about reachability.

## How this app is put together (what makes things reachable)

- One Express process serves both `/api/*` (JSON) and the built SPA. The middleware order in
  `src/api/app.ts` is load-bearing: `helmet()` → `express.json()` → `apiRouter` → `/api` JSON 404 → `express.static(dist/ui)` →
  `spaFallback` → `notFoundHandler` → `errorHandler`.
- Routes are mounted in `src/api/routes/index.ts`. Any router added there is public: **there is no
  auth middleware yet**, and no auth secret in `src/api/config.ts` (the old `ADMIN_PASS`
  placeholder was dropped on purpose).
- `config.oncade` (`src/api/config.ts`) holds the optional Oncade platform API key and business ID
  (`undefined` when both are unset). Only the invoice module (`invoice.service.ts`, `invoice.oncade.ts`) uses it. The key is a server-side secret: it
  must never reach the UI bundle, a response body, a log line or an error message.
- Feature APIs live in `src/api/feature/<name>/` (`*.router.ts`, `*.service.ts`, `*.schema.ts`,
  `*.storage.ts`). The router validates request input with **zod** through `parseOrThrow`
  (`src/api/lib/http.ts`) and holds no business rules. The service holds the rules and throws
  `AppError` (`src/api/lib/errors.ts`). Both errors reach `errorHandler`, which answers them before
  its generic 4xx/500 branches. A 400 returns `z.flattenError(...).fieldErrors` (plus `message` for
  whole-body errors). `AppError` messages go to the client verbatim, so they must never quote a
  secret or an upstream body beyond Oncade's short, capped message. Write bodies use
  `z.strictObject`, so unknown keys are rejected.
- `clients` (`GET /api/clients`, `GET|PATCH /api/clients/:id`) and `plans`
  (`GET|POST /api/plans`, `GET|PATCH /api/plans/:id`) are backed by in-memory mock arrays, so there
  is no database and no injection sink yet. Writes replace records in those arrays and last until
  restart. `PATCH /api/clients/:id` only changes `planId`. Client records hold contact PII (name,
  email), which matters once auth lands.
- `invoices` (`GET /api/invoices`, `GET /api/invoices/config`, `GET /api/invoices/:id`,
  `POST /api/invoices`, `POST /api/invoices/:id/send|cancel`) proxy to Oncade over HTTPS
  (`src/api/feature/invoice/invoice.oncade.ts`). This is the app's only **outbound** call. It also
  has real-world side effects: `send` makes Oncade email the client. Things to check:
  - **Recipient:** it must keep coming from the client record, never the request body.
  - **Path safety:** invoice ids must stay regex-limited before they reach the outbound path.
  - **Idempotency:** writes must keep requiring an `Idempotency-Key`.
  - **Payment link:** `payUrl` must stay https-only, because it becomes an `href`.
  - **Logging:** Oncade response bodies hold client PII and must not be logged; only the shape
    errors are. Fetch failures log only the error name and system code, because some fetch error
    messages can quote a header value, and one header holds the key.
  - **Read exposure (known, deferred to auth):** the open `GET /api/invoices` and
    `GET /api/invoices/:id` return **every** invoice of the Oncade business in the key's
    environment. That includes invoices made in the Oncade dashboard for people who aren't clients
    here, with their names, emails and live payment links. This is broader than the existing client
    PII exposure. List it as a priority when auth lands, but don't report it before then.
- **The write endpoints are unauthenticated by decision**, until an auth layer is built.
- Express 5 forwards rejected promises from async handlers to `errorHandler` automatically.
- `config.nodeEnv` defaults to `'development'` when `NODE_ENV` is unset, and `errorHandler` returns
  `err.message` only in development. The Docker image sets `NODE_ENV=production`; other deploys may
  not.

## Checklist

### 1. Input handling and injection (`src/api/**`)

- New `req.body` / `req.query` / `req.params` / header values used without validation of type,
  shape and length. `express.json()` gives `unknown`-shaped data, and `req.query` values can be
  arrays or objects (`?a[b]=1`).
- SQL/NoSQL built by string concatenation or template literals instead of parameters. For Mongo-style
  queries, watch for operator injection (`{ "$ne": null }` arriving in a JSON body).
- `child_process` (`exec`, `execSync`, `spawn` with `shell: true`) fed with request data.
- **Path traversal:** `path.join` / `path.resolve` / `res.sendFile` / `fs.*` with user input, without
  resolving and then checking that the result stays inside an allowed base directory.
- Prototype pollution: deep merges or `Object.assign` of request JSON into shared objects, or keys
  like `__proto__` / `constructor` reaching an object used as a map.
- ReDoS: new regexes with nested quantifiers run against request input.
- SSRF: `fetch` / `http.request` to a URL or host that comes from the request.

### 2. Authentication and authorization

- New state-changing or data-returning routes with no auth check. While no auth middleware exists,
  report this as a **design note**, not a vulnerability, unless the route exposes sensitive data or
  actions.
- Once auth exists, check that new routes are mounted **behind** it and do not bypass it through
  router order.
- Comparing secrets (passwords, tokens, HMACs) with `===` / `!==` instead of
  `crypto.timingSafeEqual` on equal-length buffers.
- Sessions and cookies: missing `httpOnly`, `secure` or `sameSite`; session IDs or tokens in URLs;
  JWTs verified without pinning the algorithm, or decoded instead of verified.
- Login or password endpoints with no rate limiting or lockout.
- Authorization checked in the UI only, not enforced on the API.

### 3. Secrets and configuration

- Hard-coded credentials, API keys or tokens in source, tests, Dockerfile or config.
- Logging secrets or entire `process.env` / `config` objects, or putting secrets in error messages.
- New **fail-open defaults**: an env var whose fallback is the insecure option (the
  `NODE_ENV ?? 'development'` pattern). Required secrets should go through `requireEnv`.
- Secrets that reach the client bundle: any value exposed through Vite (`import.meta.env.VITE_*`)
  ships to every browser.
- Changes that loosen the `.env` guardrails in `.claude/settings.json` or `.claude/hooks/`.

### 4. Error handling and information leakage

- `errorHandler` (`src/api/middleware/error-handler.ts`) changed to return `err.stack`,
  `err.message` or internal details outside development, or changed so it no longer has four
  parameters. Express identifies error handlers by arity.
- New handlers that `res.json(err)` or send raw upstream or database errors to the client.
- Responses that echo internal paths, versions or configuration. `x-powered-by` is disabled; keep it
  that way.

### 5. Middleware order and static serving (`src/api/app.ts`)

- Reordering that lets unknown `/api/*` requests fall through to `spaFallback` (HTML instead of a
  JSON 404), or that puts routes after `errorHandler`.
- `express.static` pointed at anything broader than `config.uiDir`, or with `dotfiles: 'allow'`.
- `UI_DIST_DIR` or any other path setting that can be steered toward the repo root, which would
  serve source, `package.json` or `.env`.
- Request body limits removed or raised a lot (the `express.json()` default is 100kb).

### 6. HTTP headers, CORS and CSRF

- CORS with `origin: '*'` (or origin reflection) together with `credentials: true`.
- New cookie-authenticated state-changing endpoints without CSRF protection (SameSite cookies, a
  token, or an `Origin` check).
- `helmet()` in `src/api/app.ts` removed, moved after any route or static handler, or weakened:
  CSP turned off, `'unsafe-inline'` / `'unsafe-eval'` / `*` / `https:` added to `script-src`,
  `frame-ancestors` loosened, HSTS disabled, or `upgrade-insecure-requests` dropped outside
  development. A new third-party origin in the UI needs a narrow CSP entry for that origin only.

### 7. UI (`src/ui/**`)

- `dangerouslySetInnerHTML`, `innerHTML` or `document.write` with data that is not a constant.
- User-controlled URLs in `href` / `src` / `window.location` without blocking `javascript:` and
  `data:` schemes.
- Tokens or secrets in `localStorage` / `sessionStorage`, or in query strings.
- `postMessage` listeners that do not check `event.origin`.
- Open redirects driven by a `?next=` / `?redirect=` parameter.

### 8. Docker and build

- `USER node` removed or moved before steps that need it, or the runtime stage running as root.
- Secrets passed through `ARG` / `ENV` (they persist in image history), or `COPY` of `.env*` files.
- `.dockerignore` must keep excluding `.env` and should exclude every real `.env.*`. The build stage
  runs `COPY . .`.
- Base image switched to a floating or unpinned tag, or the multi-stage split collapsed so dev
  dependencies or sources ship in the runtime image.

### 9. Dependencies

- New runtime dependencies: check that the package is well known and maintained, has no install
  scripts it does not need, and is spelled correctly (typosquatting). Flag `postinstall` hooks.
- Version ranges loosened from exact pins, or `package-lock.json` changes that do not match
  `package.json` changes.
- New `npm overrides` that silence peer or security constraints.

## Severity

| Severity     | Meaning                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------- |
| **critical** | Remote, unauthenticated compromise: RCE, auth bypass, secret disclosure, arbitrary file read      |
| **high**     | Exploitable with modest preconditions: stored XSS, SQL injection behind auth, IDOR on data        |
| **medium**   | Real but limited: reflected XSS that needs user interaction, info leak of internals, missing CSRF |
| **low**      | Defence in depth: missing headers, weak defaults with no current exploit path                     |

## Do not report

- Style, naming or formatting issues. Prettier and oxlint handle them.
- Theoretical issues with no reachable input path in the current code.
- Test-only code and fixtures, unless they ship in the build.
- The missing auth layer (and the absence of any auth secret in config) on `/api/health`, the
  `clients`, `plans` and `invoices` reads, and the `POST`/`PATCH` endpoints listed above
  (including the invoice create, send and cancel routes). All of these are
  documented as intentional until auth lands. A _new_ unauthenticated write endpoint still gets a
  design note.
- `.ts` extensions in relative imports under `src/api`. They are intentional (see CLAUDE.md).
- Denial of service through sheer request volume. Rate limiting matters only on auth endpoints.

## Report format

For each finding, ordered most severe first:

```
[severity] file/path.ts:LINE — one-line title
  Issue:    what is wrong, in one or two sentences
  Exploit:  who sends what, through which path, with what result
  Fix:      the concrete change (code if short)
```

If nothing survives verification, say so plainly: `No security findings in this change.` Then list
the areas you checked.

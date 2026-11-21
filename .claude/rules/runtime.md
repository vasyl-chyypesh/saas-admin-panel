---
paths:
  - 'Dockerfile'
  - '.dockerignore'
  - 'src/api/app.ts'
  - 'src/api/config.ts'
  - 'src/api/server.ts'
  - 'src/api/middleware/**'
---

# Runtime, CSP and Docker

- `config.nodeEnv` defaults to `development` when `NODE_ENV` is unset, and development drops the
  CSP's `upgrade-insecure-requests`. The image sets `NODE_ENV=production`; deploys outside Docker
  must set it explicitly.
- With `upgrade-insecure-requests`, plain HTTP breaks wherever the browser upgrades asset requests:
  Safari even on `localhost`, every browser on a LAN IP or hostname. To test the container over
  plain HTTP, run it with `-e NODE_ENV=development`.
- `uiDir` resolves against `process.cwd()`, so `npm start` must run from the repo root (the image
  sets `WORKDIR /app`). Override with `UI_DIST_DIR`.
- `spaFallback` calls `next()` when `dist/ui/index.html` is missing: that is `dev:api` without a
  build, where Vite serves the UI and a 404 is the honest answer.
- No secrets in the image. Oncade vars are passed at run time; without them the invoice routes
  answer 503. `.dockerignore` drops `test/`; the runner stage copies only `dist/` and production
  `node_modules` and runs as `node`.
- The `HEALTHCHECK` polls `/api/health` with `node -e fetch(...)`: there is no curl in Alpine.

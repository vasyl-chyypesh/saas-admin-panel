---
paths:
  - 'src/api/**'
---

# API conventions

## Feature modules (`src/api/feature/<name>/`)

- `<name>.router.ts`: **HTTP only**. Parse params, query, body and headers with `parseOrThrow`,
  call the service, choose the status and response shape. No business rules, no `try/catch`.
- `<name>.service.ts`: the business rules, as plain exported functions that take parsed values and
  return records or throw `AppError`. Never imports express.
- `<name>.schema.ts`: zod schemas and `z.infer` types. The UI imports these with `import type`.
- `<name>.storage.ts`: an in-memory mock array, parsed with the record schema at import so bad mock
  data fails at boot. Writes last until the process restarts. Invoices use `invoice.oncade.ts`.
- Imports run one way: a router imports only its own service; a service imports its own storage
  (or Oncade client) and other features' **services**, never their storage. The one exception is
  `client.storage.ts` → `plan.storage.ts`, the boot check on mock `planId`s.
- Routers import services as a namespace (`import * as planService from './plan.service.ts'`),
  because a service and its storage often share function names.
- Services expose `getX` (throws `not-found`) for their own routes and `findX` (returns
  `undefined`) for other features, which decide what a missing reference means to them: an unknown
  `planId` in a client PATCH is a 400, not a 404.

## Errors

- Expected failures are **thrown**. Express 5 forwards sync throws and rejected promises to
  `errorHandler`, so async handlers are safe (hence `oxc/no-async-endpoint-handlers` is off).
- Bad input: `parseOrThrow` throws `RequestValidationError` → 400 `{ error, message?, details }`.
  `message` appears only for errors on the whole body (unknown key, body not an object).
- Business failures: `AppError(kind, message, { field? })` from `src/api/lib/errors.ts`; the kind →
  status map is there. With a `field`, a 400 or 409 also gets `details: { [field]: [message] }`.
- `AppError` deliberately has **no `status` property**: `errorHandler` answers known errors first,
  then any error with a 4xx `status` (body-parser errors) with a fixed message.
- Write bodies are `z.strictObject`, so an unknown key is a 400. Query strings strip unknown keys.

## Domain rules spanning files

- Plan prices are integers in cents, `null` meaning custom pricing; both set or both `null`.
  `currency` must be `USD` because plans are invoiced through Oncade, which bills in USD only.
- Plan `code` is unique (409) and immutable. Plans are never deleted; `archived` keeps them on
  existing clients but blocks new attachments (409, unless re-sending the client's current plan).
- `planId` is the only writable client field. The dependency runs client → plan only.
- `config.oncade` is `undefined` when both Oncade vars are blank. Setting only one, a key without
  the `oncade_platform_test_`/`oncade_platform_live_` prefix, or a non-https `ONCADE_API_URL`
  throws at boot.

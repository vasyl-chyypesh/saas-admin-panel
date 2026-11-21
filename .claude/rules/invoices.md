---
paths:
  - 'src/api/feature/invoice/**'
  - 'src/ui/feature/invoice/**'
---

# Invoices (Oncade, phase 1)

There is **no storage file**: Oncade is the source of truth. Research, API notes and the phase
plan are in `src/api/feature/invoice/oncade-invoices.md`; where its §11 proposal differs from the
code, the code wins.

## How it is built

- `invoice.oncade.ts` is the only code that calls Oncade: native `fetch`, 15 s timeout,
  `redirect: 'error'`, and a lenient `z.looseObject` parse (only `_id` and `status` are required).
  Every failure becomes an `OncadeError` with a `kind`.
- `toAppError` in `invoice.service.ts` maps them: other 4xx → 422 with Oncade's message; 401, 403,
  5xx, network failure or an unparseable body → 502; 404 → 404 "Invoice not found".
- Money is cents in our API, converted to Oncade's dollars only in `invoice.oncade.ts`.
- `requireOncade` (503 when `config.oncade` is unset) is added to **each route**, not with
  `invoiceRouter.use()`, so unknown paths under `/api/invoices` still 404. It runs before
  validation. `GET /api/invoices/config` always works.
- Invoice ids must match `[A-Za-z0-9_-]{1,64}`, because they go into the outbound URL.
- Each invoice we create carries `externalMetadata { source, clientId, planId }`. Per-client lists
  fetch Oncade's list (up to 10 pages of 100) and filter on it.

## Decisions to keep

- **The recipient always comes from the client record** (`company`, `email`), never from the body,
  so the open endpoint cannot email arbitrary addresses.
- `POST /api/invoices` always creates a **draft**; nothing is emailed until the invoice is sent.
- Create, send and cancel **require an `Idempotency-Key` UUID header**, forwarded to Oncade. The UI
  passes `newIdempotencyKey()`.
- **Send and cancel count as done once Oncade accepts the POST.** If the follow-up re-fetch fails,
  answer 200 `{ data: null, message }` and the UI calls the hook's `reload()`. An error would make
  the admin retry, then cancel and recreate, emailing the client twice. After a failed action the
  UI also reloads, so it shows Oncade's real status.
- Send and Cancel in the UI are a two-click confirm whose second step ignores the second click of a
  double-click.
- Drafts are **not editable**: Oncade fixes fees at creation, so the UI says to cancel and recreate.
- The open reads return **every** invoice of the Oncade business, including ones made in the Oncade
  dashboard. Put them behind auth when it lands.

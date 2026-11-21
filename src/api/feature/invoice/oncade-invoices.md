# Oncade platform invoices

Research and design notes for invoicing through Oncade's Platform API. **Phase 1 is implemented**
(see "Phases" in §11 and `.claude/rules/invoices.md`). Phases 2 and 3 are not.

Explored on 2026-11-20 from:

- Platform Invoices guide: https://pay.oncade.xyz/docs/guides/platform-invoices
- Platform API reference (invoices, invoice templates, webhooks):
  https://pay.oncade.xyz/docs/api-reference/platform
- User-facing pages: https://pay.oncade.xyz/docs/invoicing and
  https://pay.oncade.xyz/docs/paying-an-invoice

The "Webhooks Guide" that the invoices guide links to (`/docs/guides/webhooks`) returned a 404
page, so the webhook details below come only from the API reference.

---

## 1. Concepts

- **Platform**: us. We call the API with a platform API key and act _on behalf of_ a business.
- **Business**: the Oncade business that issues the invoice and gets paid. It must grant our
  platform access first (a link session or a direct invite). The result is a **grant** that holds
  scopes.
- **Recipient**: whoever pays. This is either any email address (`receiverEmail`) or another Oncade
  business (`recipientBusinessId`).
- **Environment**: `test` or `live`. It is taken from the API key and never sent in the body. Keys
  look like `oncade_platform_test_<hex>` or `oncade_platform_live_<hex>`. Each invoice belongs to
  the environment of the key that created it.
- **Currency**: USD only. It defaults to USD and does not need to be sent.
- **Payment**: the payer opens a hosted invoice page and pays by bank transfer (ACH, wire, SEPA,
  Pix, and others, depending on region) or from their own Oncade balance. The money goes to the
  business's **payout wallet**.

### Scopes

The operations allowed are the intersection of three scope sets: what Oncade approved for the
platform, what the API key holds, and what the business granted. Invoice scopes:

| Scope            | Grants                                                |
| ---------------- | ----------------------------------------------------- |
| `invoice:create` | Create invoices and recurring templates               |
| `invoice:read`   | List, get and export invoices; list and get templates |
| `invoice:update` | Update invoices and templates                         |
| `invoice:send`   | Send a draft invoice                                  |
| `invoice:cancel` | Cancel invoices **and delete recurring templates**    |

Business-operation scopes need Oncade's approval. In the test environment they are auto-approved.

---

## 2. Connection details

**API host:** `https://www.oncade.gg`. Paths are `/api/v1/platform/...`. The guide writes this as
`https://<host>/api/v1/platform/invoices`.

**Headers**

| Header                 | When                                                                              | Notes                                                          |
| ---------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `Authorization`        | Always                                                                            | `Bearer <platform_api_key>`                                    |
| `X-Oncade-API-Version` | Always                                                                            | `v1` (the default)                                             |
| `X-Target-Business-Id` | Every invoice call                                                                | Business ID from an active grant                               |
| `Idempotency-Key`      | **Required** on create (invoice and template); recommended on POST, PUT and PATCH | A UUID. Retrying with the same key does not create a duplicate |
| `Content-Type`         | Requests with a body                                                              | `application/json`                                             |

---

## 3. Invoice lifecycle

```
                POST /invoices (status omitted or "draft")
                              │
                              ▼
   ┌────────── draft ──── POST /invoices/{id}/send ───┐
   │                                                  ▼
   │     POST /invoices (status "sent") ─────────►  sent ──── payer starts ACH ───► processing
   │                                                  │                                │
   │ POST /{id}/cancel                POST /{id}/cancel │                    ACH settles │
   ▼                                                  ▼                                ▼
cancelled ◄───────────────────────────────────────────┘                             paid
```

The "Oncade balance" payment path skips `processing` and moves the invoice straight to paid.

| Status       | Meaning                                                                   | Terminal |
| ------------ | ------------------------------------------------------------------------- | -------- |
| `draft`      | Created, not delivered. The public invoice link does not show it.         | No       |
| `sent`       | Delivered (usually by email). The recipient can view and pay it.          | No       |
| `processing` | An ACH payment was started and is waiting to settle.                      | No       |
| `paid`       | Payment received.                                                         | **Yes**  |
| `cancelled`  | Cancelled by the creator, through the API or from the business dashboard. | **Yes**  |

- **Drafts are not sent automatically.** Call `/send`, or create the invoice with
  `"status": "sent"`.
- Only `draft` and `sent` invoices can be updated (`PUT`) or cancelled.
- "Overdue" appears in the Oncade dashboard UI (past the due date and unpaid), but it is **not** an
  API status. To find overdue invoices, compare `dueDate` with today on `sent` and `processing`
  invoices.
- After cancellation, the payment link stops accepting payment.

---

## 4. Invoice body

### Required fields

| Field                                        | Type   | Notes                                                                                                                                                              |
| -------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `receiverName`                               | string | Optional when `recipientBusinessId` is sent; it then defaults to that business's name                                                                              |
| `receiverEmail` **or** `recipientBusinessId` | string | Exactly one. Sending both → **400**. `recipientBusinessId` is a 24-character hex ID; an unknown business → **404**                                                 |
| `date`                                       | string | Invoice date, ISO 8601 (`2026-04-12`)                                                                                                                              |
| `payToTarget`                                | string | Always `"BUSINESS"`, which pays into the business payout wallet. `MY_ACCOUNT` is not supported for platform invoices. **400** if the business has no payout wallet |
| `items`                                      | array  | At least one `{ description, quantity, rate, amount }`. `rate` and `amount` are in **dollars**                                                                     |

### Optional fields

| Field              | Type   | Notes                                                                                                       |
| ------------------ | ------ | ----------------------------------------------------------------------------------------------------------- |
| `invoiceNumber`    | string | Generated when omitted (e.g. `INV-2026-1234567`)                                                            |
| `dueDate`          | string | ISO 8601. Must be on or after `date`                                                                        |
| `tax`              | number | Dollars, added on top of the subtotal                                                                       |
| `total`            | number | Expected total, used as a check. The server rejects the request if its own total differs by more than $0.01 |
| `note`             | string | Free text shown to the recipient                                                                            |
| `externalMetadata` | object | Our own key-value data, up to 4096 bytes as JSON. See below                                                 |
| `status`           | string | `"draft"` (default) or `"sent"` (create and send the email straight away)                                   |
| `fees`             | array  | Platform fee lines. See §6                                                                                  |

### `externalMetadata`, our reference on the invoice

- It is stored as sent and returned on create, update, get and list.
- On update, sending it **replaces** the stored object, and omitting it **keeps** the stored one.
- Recurring templates copy their metadata onto every invoice they generate.
- The field used to be called `metadata`. The guide says that a request that still sends `metadata`
  now gets a **400** that names `externalMetadata`.
- **Webhook events do not carry our data.** To link an event back to our records, put our IDs here,
  then `GET` the invoice by the `invoiceId` in the event.

### Recipient is another Oncade business

When `recipientBusinessId` is set, Oncade looks up that business's name and email. Its invoice
emails go to the business's `invoiceRecipients` list, or to the owner's email if that list is
empty. The response returns the resolved `recipientBusinessId`. An update can switch between
`receiverEmail` and `recipientBusinessId`; sending one clears the other.

---

## 5. Invoice endpoints

Every path below starts with `/api/v1/platform`. Every call needs `X-Target-Business-Id`.

| Method | Path                           | Scope            | Purpose                               |
| ------ | ------------------------------ | ---------------- | ------------------------------------- |
| GET    | `/invoices`                    | `invoice:read`   | List (paginated, filter by status)    |
| POST   | `/invoices`                    | `invoice:create` | Create (draft, or sent straight away) |
| GET    | `/invoices/{invoiceId}`        | `invoice:read`   | Get one invoice                       |
| PUT    | `/invoices/{invoiceId}`        | `invoice:update` | Replace a non-terminal invoice        |
| POST   | `/invoices/{invoiceId}/send`   | `invoice:send`   | Send a draft (triggers the email)     |
| POST   | `/invoices/{invoiceId}/cancel` | `invoice:cancel` | Cancel a draft or sent invoice        |
| GET    | `/invoices/export`             | `invoice:read`   | Export as CSV                         |

### GET `/invoices`: list

Query parameters: `page` (default 1), `limit` (default 50, max 100), and `status` (`draft` | `sent`
| `processing` | `paid` | `cancelled`).

```json
{
  "invoices": [
    {
      "_id": "inv_abc123",
      "invoiceNumber": "INV-2026-1234567",
      "receiverName": "Acme Corp",
      "total": 5000,
      "status": "sent",
      "environment": "live",
      "links": { "invoice": "https://pay.oncade.gg/platform/plat_abc/biz_abc/invoice/inv_abc123" }
    }
  ],
  "pagination": { "total": 1, "page": 1, "limit": 20, "totalPages": 1 }
}
```

`links.invoice` points to the invoice page in the Pay app.

### POST `/invoices`: create

`Idempotency-Key` is required. The call returns **201 Created** with a `Location` header.

```bash
curl -X POST "https://www.oncade.gg/api/v1/platform/invoices" \
  -H "Authorization: Bearer $PLATFORM_KEY" \
  -H "X-Oncade-API-Version: v1" \
  -H "X-Target-Business-Id: $BIZ_ID" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{
    "receiverName": "Acme Corp",
    "receiverEmail": "billing@acme.com",
    "date": "2026-04-12",
    "dueDate": "2026-05-12",
    "payToTarget": "BUSINESS",
    "items": [
      { "description": "Consulting for April 2026", "quantity": 1, "rate": 5000, "amount": 5000 }
    ],
    "externalMetadata": { "poNumber": "PO-1042" }
  }'
```

```json
{
  "_id": "inv_abc123",
  "invoiceNumber": "INV-2026-1234567",
  "receiverName": "Acme Corp",
  "receiverEmail": "billing@acme.com",
  "total": 5000,
  "status": "draft",
  "paymentSummary": { "invoiceAmount": 5000, "payerFee": 25, "totalCharged": 5025 },
  "publicInvoiceId": "uuid-...",
  "environment": "live",
  "links": { "invoice": "https://pay.oncade.gg/platform/plat_abc/biz_abc/invoice/inv_abc123" }
}
```

One guide example omits `amount` on an item (`{ "description", "quantity", "rate" }`), so the
server probably derives `amount` as `quantity × rate`. This is not stated anywhere.

### GET `/invoices/{invoiceId}`: get

The invoice must belong to the target business and to the key's environment. The response is the
invoice, including `links.invoice`.

### PUT `/invoices/{invoiceId}`: update

- **Full replacement**, not a partial update. Send the whole body (`receiverName`, a recipient,
  `date`, `payToTarget`, `items`, and so on).
- Allowed only in `draft` and `sent`. `paid` and `cancelled` cannot be changed.
- Totals and payouts are recalculated. **Fee lines are not**; they stay as they were at creation.
- `receiverEmail` and `recipientBusinessId` can be switched; sending one clears the other.

### POST `/invoices/{invoiceId}/send`: send

Moves a `draft` to `sent` and emails the recipient. Allowed only from `draft`.

Optional body: `{ "sendEmail": false }` moves the invoice to `sent` **without** sending the email.
The response then includes `"emailSuppressed": true`. This is useful when we send our own
notification. (Only the guide documents `sendEmail`; the reference does not list it.)

```json
{ "_id": "inv_abc123", "status": "sent", "invoiceNumber": "INV-2026-1234567" }
```

### POST `/invoices/{invoiceId}/cancel`: cancel

Allowed from `draft` or `sent`. `cancelled` is terminal.

```json
{ "_id": "inv_abc123", "status": "cancelled", "invoiceNumber": "INV-2026-1234567" }
```

### GET `/invoices/export`: CSV export

Query parameters: `from` and `to` (ISO 8601), `invoiceIds` (comma-separated), and `status` (one of
the five statuses; any other value → 400). The response is a CSV file. The column layout is not
documented.

---

## 6. Fees

Fees are charged **to the payer**, on top of the invoice total. The business still receives the
full invoice amount.

| Type               | Source                                                      | When                         |
| ------------------ | ----------------------------------------------------------- | ---------------------------- |
| Oncade service fee | The business's pricing configuration, or the global default | Always. Cannot be turned off |
| Platform fees      | The `fees` array we send at creation                        | Only when we send it         |

Each platform fee entry:

| Field             | Type   | Notes                                          |
| ----------------- | ------ | ---------------------------------------------- |
| `label`           | string | Display name                                   |
| `percentage`      | number | Percent of the invoice total, 0–100. Default 0 |
| `flat`            | number | **Cents** (items are in dollars). Default 0    |
| `recipientWallet` | string | Wallet address that receives this fee          |

```json
"fees": [
  { "label": "Platform Processing Fee", "percentage": 2.5, "flat": 50, "recipientWallet": "0xYourPlatformWallet" }
]
```

- Fees are calculated **once, at creation**, and stored. A `PUT` does not recalculate them.
- The response includes
  `paymentSummary: { invoiceAmount, payerFee, totalCharged }`, where
  `totalCharged = invoiceAmount + payerFee` and `payerFee` is the sum of all fees.

---

## 7. Recurring invoices (invoice templates)

A template generates a **draft** invoice on its `anchorDay` every month. Generated invoices are
**never sent automatically**; each one has to be sent (`/send`) or reviewed in the dashboard. There
is no start or end date. To stop a template, pause it (`status: "paused"`) or delete it.

| Method | Path                              | Scope            | Purpose                                                                 |
| ------ | --------------------------------- | ---------------- | ----------------------------------------------------------------------- |
| GET    | `/invoice-templates`              | `invoice:read`   | List, newest first                                                      |
| POST   | `/invoice-templates`              | `invoice:create` | Create (201 + `Location`)                                               |
| GET    | `/invoice-templates/{templateId}` | `invoice:read`   | Get one template (403 if it belongs to another business or environment) |
| PUT    | `/invoice-templates/{templateId}` | `invoice:update` | Replace (same fields as create)                                         |
| DELETE | `/invoice-templates/{templateId}` | `invoice:cancel` | Delete (204). Invoices it already generated are kept                    |

**Body**

| Field                 | Required | Notes                                                                                              |
| --------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `name`                | yes      | Template name                                                                                      |
| `recurrence`          | yes      | `{ "anchorDay": 1-28 }`. **Monthly only**                                                          |
| `items`               | yes      | Same shape as invoice items (dollars). Copied onto every generated invoice                         |
| `receiverName`        | *        | Required unless `recipientBusinessId` is sent                                                      |
| `receiverEmail`       | *        | Required unless `recipientBusinessId` is sent. The two are mutually exclusive                      |
| `recipientBusinessId` | *        | 24-character hex ID                                                                                |
| `receiverAddress`     | no       | Recipient's postal address                                                                         |
| `payToTarget`         | no       | `"BUSINESS"` if sent                                                                               |
| `tax`                 | no       | Dollars                                                                                            |
| `currency`            | no       | `"USD"` if sent                                                                                    |
| `netDays`             | no       | Payment terms, 0–365, default 30. Each invoice is due on its creation date + `netDays`             |
| `status`              | no       | `"active"` (default) or `"paused"`                                                                 |
| `note`                | no       | Copied onto generated invoices                                                                     |
| `metadata`            | no       | The reference lists `metadata` here, but the guide says templates copy `externalMetadata`. See §10 |

- Changing `anchorDay` reschedules the next run. Other edits keep the schedule.
- Invoices that were already generated are not changed by an update.
- `Idempotency-Key` is required on create.

```json
{
  "_id": "tpl_abc123",
  "businessId": "biz_abc",
  "name": "Monthly retainer",
  "status": "active",
  "receiverName": "Acme Corp",
  "receiverEmail": "billing@acme.com",
  "items": [{ "description": "Retainer", "quantity": 1, "rate": 500, "amount": 500 }],
  "currency": "USD",
  "payToTarget": "BUSINESS",
  "recurrence": { "anchorDay": 15 },
  "netDays": 30,
  "nextRunAt": "2026-11-15T00:00:00.000Z",
  "environment": "live"
}
```

The template list uses a **different pagination shape** from the invoice list:
`{ page, limit, totalCount, totalPages, hasNextPage, hasPrevPage }`. Query parameters are `page`
(default 1) and `limit` (default 50, max 100).

---

## 8. Webhooks

The webhook URL is set in the Oncade platform settings, once for the whole platform. Every delivery,
including each retry, carries these headers:

| Header                 | Value                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------- |
| `x-oncade-signature`   | Hex HMAC-SHA256 of the **raw** request body, keyed with the platform webhook secret |
| `x-oncade-event`       | Event type, the same as `event` in the body                                         |
| `x-oncade-platform-id` | Our platform ID                                                                     |

Payload envelope: `{ "event": "...", "data": { ... }, "timestamp": "ISO" }`.

Invoice events:

| Event                        | When                                                              |
| ---------------------------- | ----------------------------------------------------------------- |
| `Platform.Invoice.Created`   | Created through the Platform API                                  |
| `Platform.Invoice.Updated`   | Updated through the Platform API                                  |
| `Platform.Invoice.Sent`      | Moved from draft to sent                                          |
| `Platform.Invoice.Cancelled` | Cancelled through the API **or by the business in its dashboard** |
| `Platform.Invoice.Paid`      | Payment completed                                                 |

- The docs show **no example `data` payload for invoice events**. They say we receive an
  `invoiceId`, and we then `GET` the invoice to read `externalMetadata`.
- No event is listed for `processing` (ACH started), and none for invoices that recurring templates
  generate.

Signature verification, from the reference:

```js
const crypto = require('crypto');

// rawBody: the request body as a Buffer, read before any JSON parsing
function verifyWebhook(rawBody, signature, secret) {
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const received = Buffer.from(signature || '', 'utf8');
  const computed = Buffer.from(expected, 'utf8');
  return received.length === computed.length && crypto.timingSafeEqual(received, computed);
}
```

Re-serialising parsed JSON with `JSON.stringify` can change the bytes and break the match, so the
HMAC must run over the bytes exactly as they arrived.

---

## 9. Errors seen in the docs

The docs do not describe the error body format. These are the status codes they mention:

| Status | Cause                                                                                                                                                                                                                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 400    | Both `receiverEmail` and `recipientBusinessId` sent; the business has no payout wallet (`BUSINESS` target); `metadata` sent instead of `externalMetadata`; `total` off by more than $0.01; bad `status` filter on export |
| 403    | Template belongs to another business or environment                                                                                                                                                                      |
| 404    | `recipientBusinessId` not found                                                                                                                                                                                          |
| —      | Updating or cancelling a `paid` or `cancelled` invoice is rejected (status code not documented)                                                                                                                          |

---

## 10. Gaps and contradictions in the Oncade docs

1. **`metadata` vs `externalMetadata`.** The guide says `metadata` now returns 400, but the
   reference's create-invoice and template bodies still list `metadata`. Plan to use
   `externalMetadata`, and confirm whether templates accept it.
2. **Units are mixed.** Item `rate`, `amount` and `tax` are in **dollars**. Fee `flat` is in
   **cents**. The units of `paymentSummary` are not stated; the example values (5000 / 25 / 5025)
   look like dollars.
3. **`sendEmail: false`** on `/send` appears only in the guide.
4. **The send endpoint** is called idempotent by its example (it sends an `Idempotency-Key`), but
   the text only requires the key on create.
5. **Webhooks**: no invoice payload examples, no documented retry schedule or timeout, and the
   Webhooks Guide link is dead.
6. **Export CSV columns** are not documented.
7. Whether `amount` is optional (derived from `quantity × rate`) is not stated.
8. Whether `invoiceNumber` must be unique, and its format rules, are not stated.

---

## 11. Integration notes for this admin panel

How Oncade invoicing would fit the current app (see `CLAUDE.md` for the existing architecture).

### Decisions (2026-11-20)

| Decision                    | Choice                                                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How invoices are sent       | **Manually.** An admin creates a draft for a client, reviews it, and presses Send. There is no scheduler and nothing is sent automatically. Recurring templates are left out for now                                |
| Oncade businesses           | **One.** We are the single business that invoices our clients. `X-Target-Business-Id` is a fixed value from config, never taken from a request                                                                      |
| Plan currency               | **USD only.** `plan.schema.ts` accepts only `currency: "USD"` on create and update, and the plan form shows the currency read-only. Every plan can therefore be invoiced                                            |
| Suspended / churned clients | **Leave their open invoices alone.** A change of client status does not cancel or edit any invoice. The admin cancels by hand if needed                                                                             |
| Platform fee                | **Yes, in a later phase.** Every invoice will carry one platform fee line in `fees[]`, built from config. The payer pays it on top of the invoice total and Oncade's own service fee (§6). See "Platform fee" below |
| Phase 1 scope               | **Only `ONCADE_API_KEY` and `ONCADE_BUSINESS_ID`.** No platform fee and no webhooks yet. Status is read by re-`GET`. See "Phases" below                                                                             |

### Phases

| Phase | Adds                                                                                                                                    | Env vars                                                                               |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1 ✅  | **Done.** Create (as a draft), send, cancel and list invoices. No editing: cancel and recreate instead. Status is refreshed by re-`GET` | `ONCADE_API_KEY`, `ONCADE_BUSINESS_ID` (both already in `.env.example`)                |
| 2     | Platform fee on every new invoice                                                                                                       | `ONCADE_FEE_LABEL`, `ONCADE_FEE_PERCENT`, `ONCADE_FEE_FLAT_CENTS`, `ONCADE_FEE_WALLET` |
| 3     | Webhooks push status changes (`processing`, `paid`, cancelled from the dashboard)                                                       | `ONCADE_WEBHOOK_SECRET`                                                                |

Phase 1 invoices carry **no** platform fee, and fees can't be added to an invoice after it is
created. Only invoices created after phase 2 ships will have the fee.

### Platform fee

Phase 2. From then on, every `POST /invoices` sends exactly one entry, built from config and never
from the request:

```jsonc
// Placeholders show which env var fills each field.
"fees": [
  {
    "label": "<ONCADE_FEE_LABEL>",
    "percentage": <ONCADE_FEE_PERCENT>,
    "flat": <ONCADE_FEE_FLAT_CENTS>,
    "recipientWallet": "<ONCADE_FEE_WALLET>"
  }
]
```

- **The client pays it.** Fees are charged to the payer, so the client pays
  `invoice total + Oncade service fee + our fee` (`paymentSummary.totalCharged`). The business still
  receives the full invoice amount, and the fee goes to `recipientWallet`. The fee is visible to the
  client, so the label should read well, e.g. `"Processing fee"`.
- **Units.** `percentage` is 0–100 and applies to the invoice total. `flat` is in **cents**, unlike
  item prices, which are in dollars. Both default to 0, so config may set either or both.
- **It is fixed at creation.** Oncade calculates fees when the invoice is created, and `PUT` never
  recalculates them. If a draft's amounts change after creation, the fee is stale. The manual flow
  below works around this.
- **Config is validated at boot** (`src/api/config.ts`), like the Oncade key. The wallet must be a
  `0x` address, the percentage 0–100, and the flat amount a non-negative integer. A misconfigured fee
  stops the server instead of producing wrong invoices.
- **We can't show the full total before creation.** Oncade's service fee comes from the business's
  pricing settings and only appears in `paymentSummary` after create. The UI can preview our own fee,
  but the full `totalCharged` is first known on the draft. That's fine, because a draft is never
  emailed: the admin sees `totalCharged` before pressing Send.

### Mapping our data

| Ours                                              | Oncade                                                                                                                                                                                                      |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client.email`                                    | `receiverEmail`                                                                                                                                                                                             |
| `client.company` (or `client.name`)               | `receiverName`                                                                                                                                                                                              |
| `plan.prices.monthly` / `.yearly` (integer cents) | `items[].rate` / `amount` in **dollars** → divide by 100 and keep 2 decimals. Use integer arithmetic and format with string conversion, not floating-point maths, the same way the UI already parses prices |
| `plan.currency`                                   | Always `USD` (see Decisions), which matches Oncade. Nothing is sent, because USD is Oncade's default                                                                                                        |
| `plan.prices === null` (custom pricing)           | Nothing to prefill. The admin types the line items by hand                                                                                                                                                  |
| `plan.name`                                       | Item `description`, e.g. `"Pro plan — November 2026"`                                                                                                                                                       |
| `client.id`, `plan.id`                            | `externalMetadata: { source: "saas-admin-panel", clientId, planId }`, so per-client lists and (later) webhooks can be matched back. The billing period is only in the line description                      |

### Manual sending flow

1. **Compose locally.** On the client page the admin picks a period (monthly or yearly). We prefill
   one line item from the client's plan price, and the admin edits items, due date and note in our
   form. Clients with no plan or a custom-priced plan get an empty form instead. Nothing reaches
   Oncade yet, so the amounts are final before the fee is calculated.
2. **Create the draft.** `POST /invoices` **without** `status`, with the platform fee attached, so
   Oncade stores a `draft` and emails nobody. Show the returned `paymentSummary` (invoice amount,
   all fees, total the client pays).
3. **Change a draft.** For fields that don't affect the amount (`note`, `dueDate`, recipient), use a
   full-body `PUT`. For **amount changes** (items, `tax`), cancel the draft and create a new one, so
   the fee is recalculated. A `PUT` would leave the fee calculated on the old amount. The cancelled
   draft stays in Oncade's list as `cancelled`.
4. **Send.** The admin presses Send, which calls `POST /invoices/{id}/send`, and Oncade emails the
   payment link. Ask for confirmation in the UI first, because this step cannot be undone.
5. **Track.** In phase 1, status (`processing`, `paid`, `cancelled`) is refreshed by re-`GET` when
   the admin opens the invoice or the list. Webhooks take over in phase 3.

Effects of this choice:

- Monthly and yearly plans work the same way, because the admin picks the period. No scheduler is
  needed.
- Recurring templates (§7) would still fit later: they produce **drafts only**, which matches
  manual sending. They are out of scope for now.
- Changing or detaching a client's plan (`PATCH /api/clients/:id`) does not affect invoices that
  already exist. Open drafts are left for the admin to cancel or edit.

### Proposed module shape (following the feature convention)

```
src/api/feature/invoice/
  invoice.schema.ts    zod schemas for our endpoints, plus Oncade request and response types
  invoice.oncade.ts    thin fetch client: headers, Idempotency-Key, error mapping
  invoice.service.ts   rules: client lookup, OncadeError → AppError, refetch after send/cancel
  invoice.storage.ts   local link between clientId and the Oncade invoiceId and status
  invoice.router.ts    /api/invoices and /api/clients/:id/invoices (HTTP only)
  invoice.webhook.ts   phase 3: POST /api/webhooks/oncade (raw body + signature check)
```

### Things the existing app forces us to handle

- **Webhook raw body vs `express.json()`.** `createApp()` registers `express.json()` globally
  before `/api`. The webhook route therefore needs `express.raw({ type: 'application/json' })`
  registered **before** `express.json()`, or the `verify` hook of `express.json()` to keep the raw
  buffer. Middleware order in `src/api/app.ts` is load-bearing, so the change must keep the
  documented order.
- **Secrets and config.** Phase 1 needs `ONCADE_API_KEY` and `ONCADE_BUSINESS_ID`. Both are in
  `.env.example` and are loaded, **optionally**, into `config.oncade` in `src/api/config.ts`.
  `config.oncade` is `undefined` when both are blank, so the invoice endpoints must answer
  `503 { error: "Oncade is not configured" }` instead of calling Oncade. There is one
  business, so `ONCADE_BUSINESS_ID` is always the value of `X-Target-Business-Id`. Later phases add
  the fee vars and `ONCADE_WEBHOOK_SECRET` (see Phases). `ONCADE_API_URL` stays optional and
  defaults to `https://www.oncade.gg`. Validate them in `src/api/config.ts` and keep them out of
  the Docker image. The key stays **server-side only**; the UI never calls Oncade.
  Server-to-server calls do not touch the CSP.
- **No auth on our write endpoints.** `CLAUDE.md` notes that write endpoints are open until an auth
  layer exists. An open endpoint that **sends real invoices** is a much larger risk than one that
  edits a plan. Until auth exists, use only a `test` key, or put invoice writes behind auth first.
- **Idempotency.** Generate the `Idempotency-Key` once per logical operation (for example, a hash
  of `clientId + period`) and store it, so that a retry after a timeout reuses the key instead of
  creating a second invoice.
- **Storage is in-memory.** The client ↔ invoice links would be lost on restart. Oncade remains the
  source of truth: we can rebuild the links by listing invoices and reading `externalMetadata`.
- **Webhook handling.** Verify the signature, then re-`GET` the invoice instead of trusting the
  payload, and handle events idempotently because retries resend them. `Platform.Invoice.Cancelled`
  can come from the business dashboard, not only from us.
- **Business setup before the first invoice.** The business must have granted the `invoice:*`
  scopes and must have a payout wallet; otherwise create returns 400.
  `GET /v1/platform/business/readiness` reports this.

### Open questions for us

Nothing blocks phase 1. Values still needed for phase 2 (platform fee):

1. The fee amount: a percentage, a flat amount in cents, or both.
2. The wallet address that receives the fee. Use a test wallet with the `test` API key, and
   confirm with Oncade which chain and token the wallet must be on.
3. The fee label the client sees on the invoice.

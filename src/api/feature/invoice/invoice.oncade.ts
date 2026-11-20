import { z } from 'zod';
import type { OncadeConfig } from '../../config.ts';
import type { Client } from '../client/client.schema.ts';
import {
  type CreateInvoiceInput,
  type Invoice,
  type InvoiceItem,
  type InvoiceStatus,
  invoiceStatusSchema,
  type PaymentSummary,
} from './invoice.schema.ts';

/**
 * Thin client for Oncade's Platform Invoice API (`oncade-invoices.md`). It converts between our
 * cents and Oncade's dollars, and turns every failure into an `OncadeError`. The API key goes only
 * into the `Authorization` header: never into a log line, an error message or a response.
 */

const REQUEST_TIMEOUT_MS = 15_000;
/** Oncade's maximum page size. */
const PAGE_SIZE = 100;
/** 10 pages × 100 = 1,000 invoices. Plenty for an admin panel; beyond it the list is truncated. */
const MAX_PAGES = 10;
/** Tags our invoices in `externalMetadata`, so they can be told apart from dashboard-made ones. */
const SOURCE = 'saas-admin-panel';

/**
 * - `unavailable`: network failure, timeout or an Oncade 5xx
 * - `auth`: Oncade rejected our API key (401)
 * - `forbidden`: the key or grant lacks access (403)
 * - `not-found`: 404
 * - `rejected`: any other 4xx, such as a validation error or an invalid status transition
 * - `bad-response`: a success status whose body we could not understand
 */
export type OncadeErrorKind =
  'unavailable' | 'auth' | 'forbidden' | 'not-found' | 'rejected' | 'bad-response';

export class OncadeError extends Error {
  readonly kind: OncadeErrorKind;
  /** Oncade's HTTP status, or 0 when no response arrived. */
  readonly status: number;

  constructor(kind: OncadeErrorKind, status: number, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'OncadeError';
    this.kind = kind;
    this.status = status;
  }
}

// --- Money ---------------------------------------------------------------------------------------

/** 1999 → 19.99. Division of an integer by 100 serialises as the exact decimal in JSON. */
const toDollars = (cents: number): number => cents / 100;
/** 19.99 → 1999. Rounding absorbs float noise such as 19.99 * 100 = 1998.9999999999998. */
const toCents = (dollars: number): number => Math.round(dollars * 100);

// --- Responses -----------------------------------------------------------------------------------

/**
 * Oncade documents its invoice response only by partial examples, so parsing is lenient: unknown
 * fields pass through and anything but `_id` and `status` may be missing or `null`.
 */
const oncadeInvoiceSchema = z.looseObject({
  _id: z.string().min(1),
  status: invoiceStatusSchema,
  invoiceNumber: z.string().nullish(),
  receiverName: z.string().nullish(),
  receiverEmail: z.string().nullish(),
  date: z.string().nullish(),
  dueDate: z.string().nullish(),
  items: z
    .array(
      z.looseObject({
        description: z.string().nullish(),
        quantity: z.number().nullish(),
        rate: z.number().nullish(),
        amount: z.number().nullish(),
      }),
    )
    .nullish(),
  tax: z.number().nullish(),
  total: z.number().nullish(),
  note: z.string().nullish(),
  externalMetadata: z.record(z.string(), z.unknown()).nullish(),
  paymentSummary: z
    .looseObject({
      invoiceAmount: z.number(),
      payerFee: z.number(),
      totalCharged: z.number(),
    })
    .nullish(),
  links: z.looseObject({ invoice: z.string().nullish() }).nullish(),
  environment: z.enum(['test', 'live']).nullish(),
  createdAt: z.string().nullish(),
});

type OncadeInvoice = z.infer<typeof oncadeInvoiceSchema>;

const oncadeListSchema = z.looseObject({
  invoices: z.array(z.unknown()),
  pagination: z.looseObject({ totalPages: z.number().nullish() }).nullish(),
});

/** `2026-04-12T00:00:00.000Z` or `2026-04-12` → `2026-04-12`; anything else → `null`. */
const toDateOnly = (value: string | null | undefined): string | null =>
  value != null && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;

/** Only https links reach the UI, where they become an `href`. This blocks `javascript:` URLs. */
const toHttpsUrl = (value: string | null | undefined): string | null =>
  value != null && URL.canParse(value) && new URL(value).protocol === 'https:' ? value : null;

const toItem = (item: NonNullable<OncadeInvoice['items']>[number]): InvoiceItem => {
  const quantity = item.quantity ?? 1;
  const unitPrice = toCents(item.rate ?? 0);
  return {
    description: item.description ?? '',
    quantity,
    unitPrice,
    amount: item.amount == null ? Math.round(quantity * unitPrice) : toCents(item.amount),
  };
};

const toPaymentSummary = (summary: OncadeInvoice['paymentSummary']): PaymentSummary | null =>
  summary
    ? {
        invoiceAmount: toCents(summary.invoiceAmount),
        payerFee: toCents(summary.payerFee),
        totalCharged: toCents(summary.totalCharged),
      }
    : null;

const toInvoice = (raw: OncadeInvoice): Invoice => {
  const clientId = raw.externalMetadata?.['clientId'];
  return {
    id: raw._id,
    number: raw.invoiceNumber ?? null,
    status: raw.status,
    clientId: typeof clientId === 'string' ? clientId : null,
    receiverName: raw.receiverName ?? null,
    receiverEmail: raw.receiverEmail ?? null,
    date: toDateOnly(raw.date),
    dueDate: toDateOnly(raw.dueDate),
    items: (raw.items ?? []).map(toItem),
    tax: raw.tax == null ? null : toCents(raw.tax),
    total: raw.total == null ? null : toCents(raw.total),
    note: raw.note ?? null,
    paymentSummary: toPaymentSummary(raw.paymentSummary),
    payUrl: toHttpsUrl(raw.links?.invoice),
    environment: raw.environment ?? null,
    createdAt: raw.createdAt ?? null,
  };
};

const parseInvoice = (body: unknown): Invoice => {
  const parsed = oncadeInvoiceSchema.safeParse(body);
  if (!parsed.success) {
    // Log the shape problem, not the body: it holds client PII.
    console.error('[oncade] unexpected invoice response:', z.prettifyError(parsed.error));
    throw new OncadeError('bad-response', 200, 'Oncade returned an unexpected response');
  }
  return toInvoice(parsed.data);
};

// --- Transport -----------------------------------------------------------------------------------

/** Oncade's error body is undocumented; take a `message` or `error` string if there is one. */
const errorMessageOf = (body: unknown): string | undefined => {
  if (typeof body !== 'object' || body === null) return undefined;
  const candidate =
    'message' in body && typeof body.message === 'string'
      ? body.message
      : 'error' in body && typeof body.error === 'string'
        ? body.error
        : undefined;
  return candidate?.slice(0, 300);
};

const errorFor = (status: number, body: unknown): OncadeError => {
  const detail = errorMessageOf(body);
  if (status >= 500) return new OncadeError('unavailable', status, 'Oncade is unavailable');
  if (status === 401) return new OncadeError('auth', status, 'Oncade rejected our API key');
  if (status === 403) {
    return new OncadeError('forbidden', status, detail ?? 'Oncade refused access');
  }
  if (status === 404) return new OncadeError('not-found', status, detail ?? 'Not found in Oncade');
  return new OncadeError('rejected', status, detail ?? `Oncade rejected the request (${status})`);
};

/** `TimeoutError`, or `TypeError (ENOTFOUND)`: the error class and system code, nothing else. */
const describeFetchError = (err: unknown): string => {
  const name = err instanceof Error ? err.name : 'Error';
  const cause = err instanceof Error ? err.cause : undefined;
  const code =
    typeof cause === 'object' && cause !== null && 'code' in cause && typeof cause.code === 'string'
      ? cause.code
      : undefined;
  return code === undefined ? name : `${name} (${code})`;
};

interface RequestOptions {
  body?: unknown;
  idempotencyKey?: string;
}

const request = async (
  oncade: OncadeConfig,
  method: 'GET' | 'POST',
  path: string,
  { body, idempotencyKey }: RequestOptions = {},
): Promise<unknown> => {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${oncade.apiKey}`,
    'X-Oncade-API-Version': 'v1',
    'X-Target-Business-Id': oncade.businessId,
  };
  if (idempotencyKey !== undefined) headers['Idempotency-Key'] = idempotencyKey;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  let text: string;
  try {
    res = await fetch(`${oncade.apiUrl}/api/v1/platform${path}`, {
      method,
      headers,
      ...(body !== undefined && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      // A redirect would carry the Authorization header to wherever it points.
      redirect: 'error',
    });
    // Inside the try: the timeout also covers the body, which can stall after the headers.
    text = await res.text();
  } catch (err) {
    // Log only the error name and the system code (ENOTFOUND, ECONNREFUSED, …). The message or
    // `cause` of some fetch errors can quote a header value, and one header holds the API key.
    console.error(`[oncade] ${method} ${path} failed: ${describeFetchError(err)}`);
    throw new OncadeError('unavailable', 0, 'Oncade is unavailable');
  }

  let json: unknown;
  try {
    json = text === '' ? undefined : JSON.parse(text);
  } catch {
    json = undefined;
  }

  if (!res.ok) {
    const error = errorFor(res.status, json);
    if (error.kind === 'auth' || error.kind === 'forbidden' || error.kind === 'unavailable') {
      console.error(`[oncade] ${method} ${path} failed with ${res.status}: ${error.message}`);
    }
    throw error;
  }
  return json;
};

// --- Operations ----------------------------------------------------------------------------------

/**
 * Every invoice of our business in the key's environment, following Oncade's pages. `status`
 * filters on Oncade's side. Entries we cannot parse are skipped and logged, not fatal.
 */
export const listInvoices = async (
  oncade: OncadeConfig,
  { status }: { status?: InvoiceStatus | undefined } = {},
): Promise<Invoice[]> => {
  const invoices: Invoice[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const query = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (status !== undefined) query.set('status', status);

    const parsed = oncadeListSchema.safeParse(await request(oncade, 'GET', `/invoices?${query}`));
    if (!parsed.success) {
      console.error('[oncade] unexpected invoice list:', z.prettifyError(parsed.error));
      throw new OncadeError('bad-response', 200, 'Oncade returned an unexpected response');
    }

    for (const entry of parsed.data.invoices) {
      const invoice = oncadeInvoiceSchema.safeParse(entry);
      if (invoice.success) invoices.push(toInvoice(invoice.data));
      else console.error('[oncade] skipped an invoice:', z.prettifyError(invoice.error));
    }

    const totalPages = parsed.data.pagination?.totalPages ?? page;
    if (page >= totalPages || parsed.data.invoices.length < PAGE_SIZE) break;
    if (page === MAX_PAGES) console.warn(`[oncade] invoice list truncated at ${MAX_PAGES} pages`);
  }
  return invoices;
};

export const getInvoice = async (oncade: OncadeConfig, id: string): Promise<Invoice> =>
  parseInvoice(await request(oncade, 'GET', `/invoices/${encodeURIComponent(id)}`));

/** The Oncade create body. The recipient comes from the client record, never from the request. */
const toCreateBody = (client: Client, input: CreateInvoiceInput) => {
  const subtotal = input.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  return {
    receiverName: client.company,
    receiverEmail: client.email,
    date: input.date,
    dueDate: input.dueDate,
    payToTarget: 'BUSINESS',
    items: input.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      rate: toDollars(item.unitPrice),
      amount: toDollars(item.quantity * item.unitPrice),
    })),
    ...(input.tax !== undefined && { tax: toDollars(input.tax) }),
    // Oncade rejects the invoice if its own total differs by more than $0.01.
    total: toDollars(subtotal + (input.tax ?? 0)),
    ...(input.note !== undefined && input.note !== '' && { note: input.note }),
    externalMetadata: { source: SOURCE, clientId: client.id, planId: client.planId },
    // `status` is omitted, so Oncade stores a draft and emails nobody.
  };
};

/** Creates a **draft**. Retrying with the same `idempotencyKey` returns the same invoice. */
export const createInvoice = async (
  oncade: OncadeConfig,
  client: Client,
  input: CreateInvoiceInput,
  idempotencyKey: string,
): Promise<Invoice> =>
  parseInvoice(
    await request(oncade, 'POST', '/invoices', {
      body: toCreateBody(client, input),
      idempotencyKey,
    }),
  );

/**
 * draft → sent; Oncade emails the payment link. Oncade answers with only a few fields, so nothing
 * is returned: the caller re-fetches the invoice (`invoice.service.ts`).
 */
export const sendInvoice = async (
  oncade: OncadeConfig,
  id: string,
  idempotencyKey: string,
): Promise<void> => {
  await request(oncade, 'POST', `/invoices/${encodeURIComponent(id)}/send`, {
    body: {},
    idempotencyKey,
  });
};

/** draft or sent → cancelled (terminal). Returns nothing, like `sendInvoice`. */
export const cancelInvoice = async (
  oncade: OncadeConfig,
  id: string,
  idempotencyKey: string,
): Promise<void> => {
  await request(oncade, 'POST', `/invoices/${encodeURIComponent(id)}/cancel`, { idempotencyKey });
};

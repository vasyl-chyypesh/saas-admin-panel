import type { JSX } from 'react';
// Type-only import: erased at build, so zod never reaches the UI bundle.
import type {
  CreateInvoiceBody,
  Invoice,
  InvoiceConfig,
  InvoiceItem,
  InvoiceStatus,
  PaymentSummary,
} from '../../../api/feature/invoice/invoice.schema.ts';
import { formatPrice } from '../../lib/money.ts';

export type {
  CreateInvoiceBody,
  Invoice,
  InvoiceConfig,
  InvoiceItem,
  InvoiceStatus,
  PaymentSummary,
};

export interface InvoiceListResponse {
  data: Invoice[];
  total: number;
}

export interface InvoiceResponse {
  data: Invoice;
}

/** Send and cancel. `data` is `null` when the action happened but the result couldn't be loaded. */
export interface InvoiceTransitionResponse {
  data: Invoice | null;
}

export interface InvoiceConfigResponse {
  data: InvoiceConfig;
}

/** Oncade invoices are USD only (plans are restricted to USD for the same reason). */
export const formatUsd = (cents: number | null): string =>
  cents === null ? '—' : formatPrice(cents, 'USD');

/** Typed as a Record so a new status on the API side fails typecheck here until labelled. */
export const invoiceStatusLabels: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  processing: 'Processing',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

export const isInvoiceStatus = (value: string): value is InvoiceStatus =>
  Object.hasOwn(invoiceStatusLabels, value);

/** Today in the viewer's time zone as `YYYY-MM-DD`, which compares correctly with ISO dates. */
const pad = (n: number): string => String(n).padStart(2, '0');

export const todayIso = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

/** `YYYY-MM-DD` plus `days`, without time-zone drift (the date is handled at UTC noon). */
export const addDaysIso = (iso: string, days: number): string => {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/** "Overdue" is not an Oncade status: it is an unpaid invoice past its due date. */
export const isOverdue = (invoice: Invoice): boolean =>
  (invoice.status === 'sent' || invoice.status === 'processing') &&
  invoice.dueDate !== null &&
  invoice.dueDate < todayIso();

// Date-only values are formatted in UTC, so 2026-11-20 never shows as Nov 19 west of Greenwich.
const dateOnlyFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' });

export const formatDateOnly = (iso: string | null): string =>
  iso === null ? '—' : dateOnlyFormat.format(new Date(`${iso}T00:00:00Z`));

export const InvoiceStatusBadge = ({ invoice }: { invoice: Invoice }): JSX.Element =>
  isOverdue(invoice) ? (
    <span className="status status--overdue">Overdue</span>
  ) : (
    <span className={`status status--${invoice.status}`}>
      {invoiceStatusLabels[invoice.status]}
    </span>
  );

/** Shown wherever invoices appear, so test invoices are never mistaken for real ones. */
export const TestModeBadge = ({
  config,
}: {
  config: InvoiceConfig | undefined;
}): JSX.Element | null =>
  config?.environment === 'test' ? <span className="mode-badge">Test mode</span> : null;

/** Describes why invoicing is unavailable, from `GET /api/invoices/config` or a 503. */
export const notConfiguredMessage =
  'Invoicing is not set up: add ONCADE_API_KEY and ONCADE_BUSINESS_ID to the server environment.';

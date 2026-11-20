import { z } from 'zod';

/**
 * Invoices live in Oncade (see `oncade-invoices.md`); this app keeps no copy. These are the shapes
 * our API speaks. Money is in cents, like plans, and is converted to Oncade's dollars at the edge.
 */

export const invoiceStatusSchema = z.enum(['draft', 'sent', 'processing', 'paid', 'cancelled']);

/** The cap keeps amounts far from float precision, as for plan prices. */
const centsSchema = z.int().nonnegative().max(100_000_000);
/** The largest invoice total we let through: $10,000,000.00. */
const MAX_TOTAL_CENTS = 1_000_000_000;
const dateOnlySchema = z.iso.date({ message: 'Use a date like 2026-11-20' });

export const invoiceItemInputSchema = z.strictObject({
  description: z.string().trim().min(1).max(200),
  quantity: z.int().min(1).max(10_000),
  /** Price of one unit, in cents. */
  unitPrice: centsSchema,
});

/**
 * `POST /api/invoices`. The recipient is deliberately absent: the server takes it from the client
 * record, so this open endpoint cannot invoice or email an arbitrary address.
 */
export const createInvoiceSchema = z
  .strictObject({
    clientId: z.uuid({ message: 'Client id must be a UUID' }),
    date: dateOnlySchema,
    dueDate: dateOnlySchema,
    items: z.array(invoiceItemInputSchema).min(1, 'Add at least one line').max(20),
    tax: centsSchema.optional(),
    note: z.string().trim().max(1000).optional(),
  })
  // ISO dates compare correctly as strings.
  .refine((body) => body.dueDate >= body.date, {
    path: ['dueDate'],
    message: 'Due date must be on or after the invoice date',
  })
  .refine(
    (body) =>
      body.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0) + (body.tax ?? 0) <=
      MAX_TOTAL_CENTS,
    { path: ['items'], message: 'Invoice total is too large' },
  );

/** `GET /api/invoices?status=&clientId=`. Unknown keys are stripped, as for the other lists. */
export const listInvoicesQuerySchema = z.object({
  status: invoiceStatusSchema.optional(),
  clientId: z.uuid({ message: 'Client id must be a UUID' }).optional(),
});

/**
 * Oncade ids (`inv_abc123`, or 24 hex characters). Restricting the alphabet keeps the value safe to
 * put in the path of the outbound Oncade request.
 */
export const invoiceIdParamsSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, { message: 'Invalid invoice id' }),
});

/** Required on every write, so a retried request never creates or sends twice. */
export const idempotencyKeySchema = z.uuid();

export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;
export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>;
export type CreateInvoiceInput = z.output<typeof createInvoiceSchema>;
/** Request body as the UI sends it. */
export type CreateInvoiceBody = z.input<typeof createInvoiceSchema>;

export interface InvoiceItem {
  description: string;
  quantity: number;
  /** Cents. */
  unitPrice: number;
  /** Cents. */
  amount: number;
}

/** What the payer is charged. Oncade computes it; fees are added on top of the invoice amount. */
export interface PaymentSummary {
  /** Cents. */
  invoiceAmount: number;
  /** All fees, in cents. */
  payerFee: number;
  /** Cents. */
  totalCharged: number;
}

/**
 * An Oncade invoice in our shape. Oncade documents its response only partly, so everything other
 * than `id` and `status` may be missing (`null`) and the UI must cope.
 */
export interface Invoice {
  id: string;
  number: string | null;
  status: InvoiceStatus;
  /** From `externalMetadata`; `null` for invoices this app did not create. */
  clientId: string | null;
  receiverName: string | null;
  receiverEmail: string | null;
  /** `YYYY-MM-DD`. */
  date: string | null;
  /** `YYYY-MM-DD`. */
  dueDate: string | null;
  items: InvoiceItem[];
  /** Cents. */
  tax: number | null;
  /** Invoice total before fees, in cents. */
  total: number | null;
  note: string | null;
  paymentSummary: PaymentSummary | null;
  /** The hosted Oncade page where the invoice is viewed and paid. Always https. */
  payUrl: string | null;
  environment: 'test' | 'live' | null;
  createdAt: string | null;
}

export interface InvoiceConfig {
  configured: boolean;
  /** From the API key prefix; `null` when Oncade is not configured. */
  environment: 'test' | 'live' | null;
}

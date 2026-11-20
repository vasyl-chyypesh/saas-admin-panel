import { type NextFunction, type Request, type Response, Router } from 'express';
import { AppError } from '../../lib/errors.ts';
import { parseOrThrow } from '../../lib/http.ts';
import {
  createInvoiceSchema,
  idempotencyKeySchema,
  invoiceIdParamsSchema,
  listInvoicesQuerySchema,
} from './invoice.schema.ts';
import * as invoiceService from './invoice.service.ts';

/**
 * HTTP only: parse the request, call the service, shape the response. Errors go to `errorHandler`.
 * Like the other write endpoints these are unauthenticated until an auth layer exists (see
 * CLAUDE.md).
 */
export const invoiceRouter: Router = Router();

/**
 * 503 when Oncade is not configured. Added to each route rather than with `use()`, so it runs
 * before validation without turning unknown paths under `/api/invoices` into 503s.
 */
const requireOncade = (_req: Request, _res: Response, next: NextFunction): void => {
  if (!invoiceService.isConfigured()) throw new AppError('unavailable', 'Oncade is not configured');
  next();
};

/** Required on writes, so a retried request never creates, sends or cancels twice. */
const readIdempotencyKey = (req: Request): string => {
  const key = idempotencyKeySchema.safeParse(req.get('Idempotency-Key'));
  if (!key.success) {
    throw new AppError('invalid', 'Send an Idempotency-Key header holding a UUID', {
      field: 'Idempotency-Key',
    });
  }
  return key.data;
};

/** Lets the UI show "Test mode" or "not configured" without probing the other routes. */
invoiceRouter.get('/config', (_req, res) => {
  res.json({ data: invoiceService.getConfig() });
});

invoiceRouter.get('/', requireOncade, async (req, res) => {
  const query = parseOrThrow(listInvoicesQuerySchema, req.query);
  const data = await invoiceService.listInvoices(query);
  res.json({ data, total: data.length });
});

invoiceRouter.get('/:id', requireOncade, async (req, res) => {
  const { id } = parseOrThrow(invoiceIdParamsSchema, req.params);
  res.json({ data: await invoiceService.getInvoice(id) });
});

/** Creates a **draft**: nothing is emailed until `POST /:id/send`. */
invoiceRouter.post('/', requireOncade, async (req, res) => {
  const idempotencyKey = readIdempotencyKey(req);
  const body = parseOrThrow(createInvoiceSchema, req.body);
  const invoice = await invoiceService.createInvoice(body, idempotencyKey);
  res
    .status(201)
    .location(`/api/invoices/${encodeURIComponent(invoice.id)}`)
    .json({ data: invoice });
});

/** Send and cancel differ only in the service call. */
const transitionHandler =
  (transition: typeof invoiceService.sendInvoice | typeof invoiceService.cancelInvoice) =>
  async (req: Request, res: Response): Promise<void> => {
    const { id } = parseOrThrow(invoiceIdParamsSchema, req.params);
    const idempotencyKey = readIdempotencyKey(req);
    const invoice = await transition(id, idempotencyKey);
    // `null`: the transition happened but the re-fetch failed. Still a success, never an error,
    // so the admin does not retry an action that already emailed the client.
    res.json(
      invoice
        ? { data: invoice }
        : { data: null, message: 'Done, but the updated invoice could not be loaded' },
    );
  };

/** draft → sent. Oncade emails the client the payment link. */
invoiceRouter.post('/:id/send', requireOncade, transitionHandler(invoiceService.sendInvoice));
/** draft or sent → cancelled (terminal). */
invoiceRouter.post('/:id/cancel', requireOncade, transitionHandler(invoiceService.cancelInvoice));

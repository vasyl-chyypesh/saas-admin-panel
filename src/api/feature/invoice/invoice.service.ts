import { config, type OncadeConfig } from '../../config.ts';
import { AppError } from '../../lib/errors.ts';
import * as clientService from '../client/client.service.ts';
import * as oncadeClient from './invoice.oncade.ts';
import type {
  CreateInvoiceInput,
  Invoice,
  InvoiceConfig,
  ListInvoicesQuery,
} from './invoice.schema.ts';

/**
 * Invoice rules. Oncade is the source of truth, so nothing is stored here: every call goes through
 * `invoice.oncade.ts`, and its `OncadeError`s are turned into `AppError`s at this boundary.
 */

export const getConfig = (): InvoiceConfig => ({
  configured: config.oncade !== undefined,
  environment: config.oncade?.environment ?? null,
});

export const isConfigured = (): boolean => config.oncade !== undefined;

const requireOncade = (): OncadeConfig => {
  if (config.oncade === undefined) throw new AppError('unavailable', 'Oncade is not configured');
  return config.oncade;
};

/** 404 → 404, other 4xx → 422 with Oncade's message, anything else → 502. */
const toAppError = (err: oncadeClient.OncadeError): AppError => {
  switch (err.kind) {
    case 'not-found':
      return new AppError('not-found', 'Invoice not found', { cause: err });
    case 'rejected':
      return new AppError('rejected', err.message, { cause: err });
    case 'auth':
    case 'forbidden':
    case 'unavailable':
    case 'bad-response':
      return new AppError('upstream', err.message, { cause: err });
  }
};

/** Runs an Oncade operation with our config, translating its failures. Other errors are bugs. */
const callOncade = async <T>(operation: (oncade: OncadeConfig) => Promise<T>): Promise<T> => {
  const oncade = requireOncade();
  try {
    return await operation(oncade);
  } catch (err) {
    if (err instanceof oncadeClient.OncadeError) throw toAppError(err);
    throw err;
  }
};

/**
 * Newest first. `status` filters on Oncade's side; `clientId` here, through the `externalMetadata`
 * we attach on creation, because Oncade cannot filter on it.
 */
export const listInvoices = async ({ status, clientId }: ListInvoicesQuery): Promise<Invoice[]> =>
  (await callOncade((oncade) => oncadeClient.listInvoices(oncade, { status })))
    .filter((invoice) => clientId === undefined || invoice.clientId === clientId)
    // Oncade's own order is undocumented; ISO strings sort chronologically.
    .toSorted((a, b) => (b.createdAt ?? b.date ?? '').localeCompare(a.createdAt ?? a.date ?? ''));

export const getInvoice = (id: string): Promise<Invoice> =>
  callOncade((oncade) => oncadeClient.getInvoice(oncade, id));

/**
 * Creates a **draft**: nothing is emailed until it is sent. The recipient comes from the client
 * record, never from the request, so the open endpoint cannot email arbitrary addresses.
 */
export const createInvoice = async (
  input: CreateInvoiceInput,
  idempotencyKey: string,
): Promise<Invoice> => {
  const client = clientService.findClient(input.clientId);
  if (!client) throw new AppError('invalid', 'Client not found', { field: 'clientId' });
  return callOncade((oncade) => oncadeClient.createInvoice(oncade, client, input, idempotencyKey));
};

/**
 * Once the transition POST succeeded it has happened: a send has already emailed the client. A
 * failing re-fetch must not turn that into an error, or the admin would retry, see Oncade refuse,
 * and likely cancel and recreate, emailing the client twice. `null` means "done, details unknown".
 *
 * Takes the config the transition used rather than looking it up again, so nothing that runs after
 * the POST can throw anything but a bug.
 */
const refetchAfterTransition = async (
  oncade: OncadeConfig,
  id: string,
): Promise<Invoice | null> => {
  try {
    return await oncadeClient.getInvoice(oncade, id);
  } catch (err) {
    if (!(err instanceof oncadeClient.OncadeError)) throw err;
    console.error(`[oncade] invoice ${id} changed, but re-fetching it failed: ${err.kind}`);
    return null;
  }
};

/** draft → sent. Oncade emails the client the payment link. An invalid transition → 422. */
export const sendInvoice = async (id: string, idempotencyKey: string): Promise<Invoice | null> => {
  const oncade = requireOncade();
  await callOncade(() => oncadeClient.sendInvoice(oncade, id, idempotencyKey));
  return refetchAfterTransition(oncade, id);
};

/** draft or sent → cancelled (terminal). An invalid transition → 422. */
export const cancelInvoice = async (
  id: string,
  idempotencyKey: string,
): Promise<Invoice | null> => {
  const oncade = requireOncade();
  await callOncade(() => oncadeClient.cancelInvoice(oncade, id, idempotencyKey));
  return refetchAfterTransition(oncade, id);
};

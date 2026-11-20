import { type JSX, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  type ApiError,
  newIdempotencyKey,
  sendJson,
  toApiError,
  useFetchJson,
} from '../../lib/api.ts';
import {
  formatDateOnly,
  formatUsd,
  type Invoice,
  type InvoiceConfigResponse,
  type InvoiceResponse,
  InvoiceStatusBadge,
  type InvoiceTransitionResponse,
  notConfiguredMessage,
  TestModeBadge,
} from './invoice.shared.tsx';

type Action = 'send' | 'cancel';

/** Two clicks for anything Oncade can't undo: the first arms the action, the second runs it. */
const actionCopy: Record<Action, { arm: string; confirm: string; warning: string }> = {
  send: {
    arm: 'Send invoice',
    confirm: 'Confirm: email the client',
    warning: 'Oncade will email the payment link to the client. This cannot be undone.',
  },
  cancel: {
    arm: 'Cancel invoice',
    confirm: 'Confirm cancel',
    warning: 'The payment link will stop accepting payment. This cannot be undone.',
  },
};

const actionsFor = (invoice: Invoice): Action[] =>
  invoice.status === 'draft' ? ['send', 'cancel'] : invoice.status === 'sent' ? ['cancel'] : [];

export const InvoiceDetailPage = (): JSX.Element => {
  const { id = '' } = useParams();
  const url = `/api/invoices/${encodeURIComponent(id)}`;
  const { data, error, loading, mutate, reload } = useFetchJson<InvoiceResponse>(url);
  const config = useFetchJson<InvoiceConfigResponse>('/api/invoices/config');

  const [armed, setArmed] = useState<Action>();
  const [running, setRunning] = useState<Action>();
  const [actionError, setActionError] = useState<ApiError>();

  const run = async (action: Action): Promise<void> => {
    setRunning(action);
    setActionError(undefined);
    try {
      const res = await sendJson<InvoiceTransitionResponse>(
        'POST',
        `${url}/${action}`,
        {},
        { 'Idempotency-Key': newIdempotencyKey() },
      );
      // `null`: the action happened, but the server couldn't load the result. Fetch it ourselves.
      if (res.data) mutate({ data: res.data });
      else reload();
      setArmed(undefined);
    } catch (err) {
      setActionError(toApiError(err));
      // The invoice may have changed anyway (the action reached Oncade, or someone paid or
      // cancelled it in the Oncade dashboard), so show its real status, not the stale one.
      setArmed(undefined);
      reload();
    } finally {
      setRunning(undefined);
    }
  };

  const backLink = (
    <Link to="/invoices" className="back-link">
      ← All invoices
    </Link>
  );

  if (error) {
    const message =
      error.status === 503
        ? notConfiguredMessage
        : error.status === 404 || error.status === 400
          ? 'Invoice not found.'
          : `Failed to load invoice: ${error.message}`;
    return (
      <section>
        <title>Invoice not found · SaaS Admin Panel</title>
        {backLink}
        <p className="notice notice--error">{message}</p>
      </section>
    );
  }

  if (loading || !data) {
    return (
      <section>
        {backLink}
        <p className="notice">Loading…</p>
      </section>
    );
  }

  const invoice = data.data;
  const title = invoice.number ?? 'Invoice';
  const actions = actionsFor(invoice);

  return (
    <section>
      <title>{`${title} · Invoices · SaaS Admin Panel`}</title>
      {backLink}
      <header className="page-header">
        <h1>{title}</h1>
        <InvoiceStatusBadge invoice={invoice} />
        <TestModeBadge config={config.data?.data} />
      </header>

      {actions.length > 0 && (
        <div className="invoice-actions">
          {actions.map((action) =>
            armed === action ? (
              <button
                key={action}
                type="button"
                className={action === 'send' ? 'button-primary' : 'button-danger'}
                disabled={running !== undefined}
                onClick={(e) => {
                  // The confirm button appears where the arm button was, so the second click of a
                  // double-click would land on it. `detail` counts rapid clicks: ignore all but one.
                  if (e.detail > 1) return;
                  void run(action);
                }}
              >
                {running === action ? 'Working…' : actionCopy[action].confirm}
              </button>
            ) : (
              <button
                key={action}
                type="button"
                className="button-ghost"
                disabled={running !== undefined}
                onClick={() => {
                  setArmed(action);
                  setActionError(undefined);
                }}
              >
                {actionCopy[action].arm}
              </button>
            ),
          )}
          {armed !== undefined && running === undefined && (
            <button
              type="button"
              className="button-link"
              onClick={() => {
                setArmed(undefined);
              }}
            >
              Keep as is
            </button>
          )}
          {armed !== undefined && <span className="hint">{actionCopy[armed].warning}</span>}
        </div>
      )}
      {actionError && (
        <p className="notice notice--error" role="alert">
          {actionError.message}
        </p>
      )}
      {invoice.status === 'draft' && (
        <p className="hint invoice-hint">
          Drafts can&apos;t be edited. To change one, cancel it and create a new invoice.
        </p>
      )}

      <dl className="details">
        <dt>Bill to</dt>
        <dd>
          <div className="cell-stack">
            <span>{invoice.receiverName ?? '—'}</span>
            {invoice.receiverEmail && <span className="muted">{invoice.receiverEmail}</span>}
          </div>
        </dd>
        {invoice.clientId && (
          <>
            <dt>Client</dt>
            <dd>
              <Link to={`/clients/${invoice.clientId}`}>View client</Link>
            </dd>
          </>
        )}
        <dt>Invoice date</dt>
        <dd>{formatDateOnly(invoice.date)}</dd>
        <dt>Due date</dt>
        <dd>{formatDateOnly(invoice.dueDate)}</dd>
        {invoice.note && (
          <>
            <dt>Note</dt>
            <dd className="pre-wrap">{invoice.note}</dd>
          </>
        )}
        {invoice.payUrl && (
          <>
            <dt>Payment page</dt>
            <dd>
              <a href={invoice.payUrl} target="_blank" rel="noopener noreferrer">
                Open in Oncade ↗
              </a>
            </dd>
          </>
        )}
        <dt>Oncade ID</dt>
        <dd>
          <code>{invoice.id}</code>
        </dd>
      </dl>

      <h2 className="section-title">Lines</h2>
      <div className="table-wrap invoice-lines">
        <table>
          <thead>
            <tr>
              <th scope="col">Description</th>
              <th scope="col" className="num">
                Qty
              </th>
              <th scope="col" className="num">
                Unit price
              </th>
              <th scope="col" className="num">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((item, index) => (
              // Lines have no id of their own and never reorder, so the index is a stable key.
              <tr key={index}>
                <td className="wrap">{item.description}</td>
                <td className="num">{item.quantity}</td>
                <td className="num">{formatUsd(item.unitPrice)}</td>
                <td className="num">{formatUsd(item.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {invoice.tax !== null && invoice.tax > 0 && (
              <tr>
                <th scope="row" colSpan={3}>
                  Tax
                </th>
                <td className="num">{formatUsd(invoice.tax)}</td>
              </tr>
            )}
            <tr>
              <th scope="row" colSpan={3}>
                Invoice total
              </th>
              <td className="num">{formatUsd(invoice.total)}</td>
            </tr>
            {invoice.paymentSummary && (
              <>
                <tr>
                  <th scope="row" colSpan={3}>
                    Fees (paid by the client)
                  </th>
                  <td className="num">{formatUsd(invoice.paymentSummary.payerFee)}</td>
                </tr>
                <tr className="grand-total">
                  <th scope="row" colSpan={3}>
                    Client pays
                  </th>
                  <td className="num">{formatUsd(invoice.paymentSummary.totalCharged)}</td>
                </tr>
              </>
            )}
          </tfoot>
        </table>
      </div>
    </section>
  );
};

import type { JSX } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useFetchJson } from '../../lib/api.ts';
import {
  formatDateOnly,
  formatUsd,
  type InvoiceConfigResponse,
  type InvoiceListResponse,
  InvoiceStatusBadge,
  invoiceStatusLabels,
  isInvoiceStatus,
  notConfiguredMessage,
  TestModeBadge,
} from './invoice.shared.tsx';

const statusTabs = [
  { value: '', label: 'All' },
  ...Object.entries(invoiceStatusLabels).map(([value, label]) => ({ value, label })),
];

export const InvoiceListPage = (): JSX.Element => {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawStatus = searchParams.get('status') ?? '';
  const status = isInvoiceStatus(rawStatus) ? rawStatus : '';

  const config = useFetchJson<InvoiceConfigResponse>('/api/invoices/config');
  const { data, error, loading } = useFetchJson<InvoiceListResponse>(
    `/api/invoices${status ? `?status=${status}` : ''}`,
  );

  const setStatus = (value: string): void => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === '') next.delete('status');
        else next.set('status', value);
        return next;
      },
      { replace: true },
    );
  };

  return (
    <section>
      <title>Invoices · SaaS Admin Panel</title>
      <header className="page-header">
        <h1>Invoices</h1>
        {data && <span className="count">{data.total}</span>}
        <TestModeBadge config={config.data?.data} />
      </header>

      <div className="toolbar">
        <div className="tabs" role="group" aria-label="Filter by status">
          {statusTabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              aria-pressed={status === tab.value}
              onClick={() => {
                setStatus(tab.value);
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="notice notice--error">
          {error.status === 503
            ? notConfiguredMessage
            : `Failed to load invoices: ${error.message}`}
        </p>
      ) : !data ? (
        <p className="notice">Loading…</p>
      ) : data.data.length === 0 ? (
        <div className="empty">
          <span>No invoices here yet. Create one from a client&apos;s page.</span>
          <Link to="/clients">Go to clients</Link>
        </div>
      ) : (
        <div className={`table-wrap${loading ? ' is-loading' : ''}`} aria-busy={loading}>
          <table>
            <thead>
              <tr>
                <th scope="col">Invoice</th>
                <th scope="col">Date</th>
                <th scope="col">Due</th>
                <th scope="col" className="num">
                  Total
                </th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((invoice) => (
                <tr key={invoice.id}>
                  <td>
                    <div className="cell-stack">
                      <Link to={`/invoices/${encodeURIComponent(invoice.id)}`} className="row-link">
                        {invoice.receiverName ?? 'Unknown recipient'}
                      </Link>
                      <span className="muted">{invoice.number ?? invoice.id}</span>
                    </div>
                  </td>
                  <td className="muted">{formatDateOnly(invoice.date)}</td>
                  <td className="muted">{formatDateOnly(invoice.dueDate)}</td>
                  <td className="num">{formatUsd(invoice.total)}</td>
                  <td>
                    <InvoiceStatusBadge invoice={invoice} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

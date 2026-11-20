import type { JSX } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useFetchJson } from '../../lib/api.ts';
import { formatDate } from '../client/client.shared.tsx';
import { formatPrice } from '../../lib/money.ts';
import { type PlanListResponse, PlanStatus } from './plan.shared.tsx';

const archivedTabs = [
  { value: '', label: 'All' },
  { value: 'false', label: 'Active' },
  { value: 'true', label: 'Archived' },
] as const;

export const PlanListPage = (): JSX.Element => {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawArchived = searchParams.get('archived');
  const archived = rawArchived === 'true' || rawArchived === 'false' ? rawArchived : '';

  const { data, error, loading } = useFetchJson<PlanListResponse>(
    `/api/plans${archived ? `?archived=${archived}` : ''}`,
  );

  const setArchived = (value: string): void => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === '') next.delete('archived');
        else next.set('archived', value);
        return next;
      },
      { replace: true },
    );
  };

  return (
    <section>
      <title>Plans · SaaS Admin Panel</title>
      <header className="page-header">
        <h1>Plans</h1>
        {data && <span className="count">{data.total}</span>}
        <div className="actions">
          <Link to="/plans/new" className="button-primary">
            New plan
          </Link>
        </div>
      </header>

      <div className="toolbar">
        <div className="tabs" role="group" aria-label="Filter by status">
          {archivedTabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              aria-pressed={archived === tab.value}
              onClick={() => {
                setArchived(tab.value);
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="notice notice--error">Failed to load plans: {error.message}</p>
      ) : !data ? (
        <p className="notice">Loading…</p>
      ) : data.data.length === 0 ? (
        <div className="empty">
          <span>No plans here yet.</span>
        </div>
      ) : (
        <div className={`table-wrap${loading ? ' is-loading' : ''}`} aria-busy={loading}>
          <table>
            <thead>
              <tr>
                <th scope="col">Plan</th>
                <th scope="col" className="num">
                  Monthly
                </th>
                <th scope="col" className="num">
                  Yearly
                </th>
                <th scope="col">Status</th>
                <th scope="col" className="num">
                  Updated
                </th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((plan) => (
                <tr key={plan.id}>
                  <td>
                    <div className="cell-stack">
                      <Link to={`/plans/${plan.id}`} className="row-link">
                        {plan.name}
                      </Link>
                      <code className="muted">{plan.code}</code>
                    </div>
                  </td>
                  <td className="num">{formatPrice(plan.prices.monthly, plan.currency)}</td>
                  <td className="num">{formatPrice(plan.prices.yearly, plan.currency)}</td>
                  <td>
                    <PlanStatus archived={plan.archived} />
                  </td>
                  <td className="num muted">
                    <time dateTime={plan.updatedAt}>{formatDate(plan.updatedAt)}</time>
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

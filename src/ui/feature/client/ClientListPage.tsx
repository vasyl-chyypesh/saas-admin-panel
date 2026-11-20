import { type JSX, useState } from 'react';
import { Link, useLocation, useNavigationType, useSearchParams } from 'react-router';
import { useFetchJson } from '../../lib/api.ts';
import {
  type ClientListResponse,
  clientStatusLabels,
  formatDate,
  isClientStatus,
  StatusBadge,
} from './client.shared.tsx';

/** Marks navigations made by this page's own filter controls (see the resync below). */
const FILTER_NAV_STATE = { fromClientFilters: true } as const;

const isFilterNavigation = (state: unknown): boolean =>
  typeof state === 'object' && state !== null && 'fromClientFilters' in state;

export const ClientListPage = (): JSX.Element => {
  // Filters live in the URL so they survive reloads and back/forward.
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigationType = useNavigationType();
  const search = searchParams.get('search') ?? '';
  const rawStatus = searchParams.get('status') ?? '';
  const status = isClientStatus(rawStatus) ? rawStatus : '';

  // The search box can't be controlled by the URL directly: React Router applies location updates
  // inside `startTransition`, so the URL lags the keystrokes and React would reset the input to the
  // stale value between them (typing "orbit" fast leaves just "t"). The text lives in local state
  // instead, and is pulled from the URL only when something other than these controls navigated
  // (the nav link, back/forward). POP always resyncs: `location.state` is stored in browser history
  // and restored on back/forward, so an entry these controls wrote still carries the marker.
  const [searchInput, setSearchInput] = useState(search);
  const [seenLocationKey, setSeenLocationKey] = useState(location.key);
  if (location.key !== seenLocationKey) {
    setSeenLocationKey(location.key);
    if (navigationType === 'POP' || !isFilterNavigation(location.state)) setSearchInput(search);
  }

  const apiParams = new URLSearchParams();
  if (search.trim() !== '') apiParams.set('search', search.trim());
  if (status !== '') apiParams.set('status', status);
  const query = apiParams.toString();

  const { data, error, loading } = useFetchJson<ClientListResponse>(
    `/api/clients${query ? `?${query}` : ''}`,
  );

  const updateFilter = (key: 'search' | 'status', value: string): void => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === '') next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true, state: FILTER_NAV_STATE },
    );
  };

  return (
    <section>
      <title>Clients · SaaS Admin Panel</title>
      <header className="page-header">
        <h1>Clients</h1>
        {data && <span className="muted">{data.total} total</span>}
      </header>

      <div className="filters" role="search">
        <input
          type="search"
          placeholder="Search name or email"
          aria-label="Search clients by name or email"
          value={searchInput}
          maxLength={100}
          onChange={(e) => {
            setSearchInput(e.target.value);
            updateFilter('search', e.target.value);
          }}
        />
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => {
            updateFilter('status', e.target.value);
          }}
        >
          <option value="">All statuses</option>
          {Object.entries(clientStatusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <p className="notice notice--error">Failed to load clients: {error.message}</p>
      ) : !data ? (
        <p className="notice">Loading…</p>
      ) : data.data.length === 0 ? (
        <p className="notice">No clients match these filters.</p>
      ) : (
        <div className={`table-wrap${loading ? ' is-loading' : ''}`}>
          <table>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Company</th>
                <th scope="col">Status</th>
                <th scope="col">Created</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((client) => (
                <tr key={client.id}>
                  <td>
                    <Link to={`/clients/${client.id}`}>{client.name}</Link>
                  </td>
                  <td>{client.email}</td>
                  <td>{client.company}</td>
                  <td>
                    <StatusBadge status={client.status} />
                  </td>
                  <td>
                    <time dateTime={client.createdAt}>{formatDate(client.createdAt)}</time>
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

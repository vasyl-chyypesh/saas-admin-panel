import { type JSX, useEffect, useRef, useState } from 'react';
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

const SKELETON_ROWS = 6;

/** True when a keystroke should go to the focused element rather than to a page shortcut. */
const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

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

  // `/` focuses the search box from anywhere on the page, as in most keyboard-first tools.
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

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

  const clearFilters = (): void => {
    setSearchInput('');
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('search');
        next.delete('status');
        return next;
      },
      { replace: true, state: FILTER_NAV_STATE },
    );
  };

  const statusTabs: { value: string; label: string }[] = [
    { value: '', label: 'All' },
    ...Object.entries(clientStatusLabels).map(([value, label]) => ({ value, label })),
  ];

  return (
    <section>
      <title>Clients · SaaS Admin Panel</title>
      <header className="page-header">
        <h1>Clients</h1>
        {data && <span className="count">{data.total}</span>}
      </header>

      <div className="toolbar">
        <div className="tabs" role="group" aria-label="Filter by status">
          {statusTabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              aria-pressed={status === tab.value}
              onClick={() => {
                updateFilter('status', tab.value);
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="search" role="search">
          <input
            ref={searchRef}
            type="search"
            placeholder="Search name or email"
            aria-label="Search clients by name or email"
            aria-keyshortcuts="/"
            value={searchInput}
            maxLength={100}
            onChange={(e) => {
              setSearchInput(e.target.value);
              updateFilter('search', e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') e.currentTarget.blur();
            }}
          />
          <kbd aria-hidden="true">/</kbd>
        </div>
      </div>

      {error ? (
        <p className="notice notice--error">Failed to load clients: {error.message}</p>
      ) : data && data.data.length === 0 ? (
        <div className="empty">
          <span>No clients match these filters.</span>
          <button type="button" className="button-ghost" onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      ) : (
        <div className={`table-wrap${loading && data ? ' is-loading' : ''}`} aria-busy={loading}>
          <table>
            <thead>
              <tr>
                <th scope="col">Client</th>
                <th scope="col">Company</th>
                <th scope="col">Status</th>
                <th scope="col" className="num">
                  Created
                </th>
              </tr>
            </thead>
            <tbody>
              {data
                ? data.data.map((client) => (
                    <tr key={client.id}>
                      <td>
                        <div className="client-cell">
                          <Link to={`/clients/${client.id}`} className="row-link">
                            {client.name}
                          </Link>
                          <span className="muted">{client.email}</span>
                        </div>
                      </td>
                      <td>{client.company}</td>
                      <td>
                        <StatusBadge status={client.status} />
                      </td>
                      <td className="num muted">
                        <time dateTime={client.createdAt}>{formatDate(client.createdAt)}</time>
                      </td>
                    </tr>
                  ))
                : Array.from({ length: SKELETON_ROWS }, (_, i) => (
                    <tr key={i} aria-hidden="true">
                      <td>
                        <span className="skeleton" style={{ width: '8rem' }} />
                        <span className="skeleton" style={{ width: '11rem' }} />
                      </td>
                      <td>
                        <span className="skeleton" style={{ width: '7rem' }} />
                      </td>
                      <td>
                        <span className="skeleton" style={{ width: '4rem' }} />
                      </td>
                      <td>
                        <span className="skeleton" style={{ width: '5rem', marginLeft: 'auto' }} />
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

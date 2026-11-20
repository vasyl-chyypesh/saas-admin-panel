import type { JSX } from 'react';
import { Link, useParams } from 'react-router';
import { useFetchJson } from '../../lib/api.ts';
import { type ClientResponse, formatDateTime, StatusBadge } from './client.shared.tsx';

export const ClientDetailPage = (): JSX.Element => {
  const { id = '' } = useParams();
  const { data, error, loading } = useFetchJson<ClientResponse>(
    `/api/clients/${encodeURIComponent(id)}`,
  );

  const backLink = (
    <Link to="/clients" className="back-link">
      ← All clients
    </Link>
  );

  if (error) {
    // 400 means the id isn't even a valid UUID; to the user that is the same as "not found".
    const notFound = error.status === 404 || error.status === 400;
    return (
      <section>
        <title>Client not found · SaaS Admin Panel</title>
        {backLink}
        <p className="notice notice--error">
          {notFound ? 'Client not found.' : `Failed to load client: ${error.message}`}
        </p>
      </section>
    );
  }

  // `data` may still hold the previous client while a new id loads, so gate on `loading` too.
  if (loading || !data) {
    return (
      <section>
        {backLink}
        <p className="notice">Loading…</p>
      </section>
    );
  }

  const client = data.data;

  return (
    <section>
      <title>{`${client.name} · SaaS Admin Panel`}</title>
      {backLink}
      <header className="page-header">
        <h1>{client.name}</h1>
        <StatusBadge status={client.status} />
      </header>

      <dl className="details">
        <dt>Email</dt>
        <dd>
          <a href={`mailto:${client.email}`}>{client.email}</a>
        </dd>
        <dt>Company</dt>
        <dd>{client.company}</dd>
        <dt>Created</dt>
        <dd>
          <time dateTime={client.createdAt}>{formatDateTime(client.createdAt)}</time>
        </dd>
        <dt>Last updated</dt>
        <dd>
          <time dateTime={client.updatedAt}>{formatDateTime(client.updatedAt)}</time>
        </dd>
        <dt>Client ID</dt>
        <dd>
          <code>{client.id}</code>
        </dd>
      </dl>
    </section>
  );
};

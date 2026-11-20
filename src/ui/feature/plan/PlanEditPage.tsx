import { type JSX, useState } from 'react';
import { Link, useParams } from 'react-router';
import { sendJson, useFetchJson } from '../../lib/api.ts';
import { type ClientListResponse, StatusBadge } from '../client/client.shared.tsx';
import { type PlanResponse, PlanStatus, type UpdatePlanBody } from './plan.shared.tsx';
import { type PlanDraft, PlanForm } from './PlanForm.tsx';

export const PlanEditPage = (): JSX.Element => {
  const { id = '' } = useParams();
  const url = `/api/plans/${encodeURIComponent(id)}`;
  const { data, error, loading, mutate } = useFetchJson<PlanResponse>(url);
  const clients = useFetchJson<ClientListResponse>(
    `/api/clients?${new URLSearchParams({ planId: id }).toString()}`,
  );
  /** `updatedAt` of the version this page saved, so the notice clears when the plan changes. */
  const [savedVersion, setSavedVersion] = useState<string>();

  const save = async ({ name, description, currency, prices, archived }: PlanDraft) => {
    const body: UpdatePlanBody = { name, description, currency, prices, archived };
    const res = await sendJson<PlanResponse>('PATCH', url, body);
    mutate(res);
    setSavedVersion(res.data.updatedAt);
  };

  const backLink = (
    <Link to="/plans" className="back-link">
      ← All plans
    </Link>
  );

  if (error) {
    // 400 means the id isn't even a valid UUID; to the user that is the same as "not found".
    const notFound = error.status === 404 || error.status === 400;
    return (
      <section>
        <title>Plan not found · SaaS Admin Panel</title>
        {backLink}
        <p className="notice notice--error">
          {notFound ? 'Plan not found.' : `Failed to load plan: ${error.message}`}
        </p>
      </section>
    );
  }

  // `data` may still hold the previous plan while a new id loads, so gate on `loading` too.
  if (loading || !data) {
    return (
      <section>
        {backLink}
        <p className="notice">Loading…</p>
      </section>
    );
  }

  const plan = data.data;
  const planClients = clients.loading ? undefined : clients.data?.data;

  return (
    <section>
      <title>{`${plan.name} · Plans · SaaS Admin Panel`}</title>
      {backLink}
      <header className="page-header">
        <h1>{plan.name}</h1>
        <PlanStatus archived={plan.archived} />
      </header>

      {savedVersion === plan.updatedAt && (
        <p className="notice notice--success" role="status">
          Changes saved.
        </p>
      )}

      {/* Keyed by version so the form re-initialises from what the server stored after a save. */}
      <PlanForm
        key={`${plan.id}:${plan.updatedAt}`}
        plan={plan}
        submitLabel="Save changes"
        onSubmit={save}
      />

      <h2 className="section-title">
        Clients on this plan
        {planClients && <span className="count">{planClients.length}</span>}
      </h2>
      {clients.error ? (
        <p className="notice notice--error">Failed to load clients: {clients.error.message}</p>
      ) : !planClients ? (
        <p className="notice">Loading…</p>
      ) : planClients.length === 0 ? (
        <p className="notice">No clients are on this plan.</p>
      ) : (
        <ul className="link-list">
          {planClients.map((client) => (
            <li key={client.id}>
              <Link to={`/clients/${client.id}`}>{client.name}</Link>
              <span className="muted">{client.company}</span>
              <StatusBadge status={client.status} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

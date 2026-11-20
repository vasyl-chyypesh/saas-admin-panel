import { type JSX, useId, useState } from 'react';
import { Link, useParams } from 'react-router';
import { type ApiError, sendJson, toApiError, useFetchJson } from '../../lib/api.ts';
import { formatPrice, type PlanListResponse } from '../plan/plan.shared.tsx';
import {
  type ClientResponse,
  formatDateTime,
  StatusBadge,
  type UpdateClientBody,
} from './client.shared.tsx';

export const ClientDetailPage = (): JSX.Element => {
  const { id = '' } = useParams();
  const url = `/api/clients/${encodeURIComponent(id)}`;
  const { data, error, loading, mutate } = useFetchJson<ClientResponse>(url);
  const plans = useFetchJson<PlanListResponse>('/api/plans');
  const planSelectId = useId();

  /** The plan picked while its PATCH is in flight, so the select doesn't snap back meanwhile. */
  const [pendingPlanId, setPendingPlanId] = useState<string | null>();
  const [planError, setPlanError] = useState<ApiError>();

  const changePlan = async (planId: string | null): Promise<void> => {
    setPendingPlanId(planId);
    setPlanError(undefined);
    try {
      const body: UpdateClientBody = { planId };
      mutate(await sendJson<ClientResponse>('PATCH', url, body));
    } catch (err) {
      setPlanError(toApiError(err));
    } finally {
      setPendingPlanId(undefined);
    }
  };

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
  const allPlans = plans.data?.data ?? [];
  const currentPlan = allPlans.find((plan) => plan.id === client.planId);
  // Archived plans can't be attached, but the client's own archived plan must still be selectable.
  const selectablePlans = allPlans.filter((plan) => !plan.archived || plan.id === client.planId);
  const saving = pendingPlanId !== undefined;
  const selectedPlanId = (saving ? pendingPlanId : client.planId) ?? '';

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
        <dt>
          <label htmlFor={planSelectId}>Plan</label>
        </dt>
        <dd>
          <div className="inline-field">
            <select
              id={planSelectId}
              className="input"
              value={selectedPlanId}
              disabled={saving || !plans.data}
              aria-invalid={planError !== undefined}
              onChange={(e) => {
                void changePlan(e.target.value === '' ? null : e.target.value);
              }}
            >
              <option value="">No plan</option>
              {selectablePlans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name} · {formatPrice(plan.prices.monthly, plan.currency)}
                  {plan.prices.monthly === null ? '' : '/mo'}
                  {plan.archived ? ' (archived)' : ''}
                </option>
              ))}
            </select>
            {currentPlan && !saving && <Link to={`/plans/${currentPlan.id}`}>View plan</Link>}
            {saving && <span className="muted">Saving…</span>}
          </div>
          {plans.error && (
            <span className="field-error">Failed to load plans: {plans.error.message}</span>
          )}
          {planError && <span className="field-error">{planError.message}</span>}
        </dd>
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

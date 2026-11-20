import { type JSX, useId, useState } from 'react';
import { Link, useParams } from 'react-router';
import { type ApiError, sendJson, toApiError, useFetchJson } from '../../lib/api.ts';
import { formatPrice } from '../../lib/money.ts';
import {
  formatDateOnly,
  formatUsd,
  type InvoiceConfigResponse,
  type InvoiceListResponse,
  InvoiceStatusBadge,
  notConfiguredMessage,
} from '../invoice/invoice.shared.tsx';
import type { PlanListResponse } from '../plan/plan.shared.tsx';
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
  const invoiceConfig = useFetchJson<InvoiceConfigResponse>('/api/invoices/config');
  const invoices = useFetchJson<InvoiceListResponse>(
    `/api/invoices?${new URLSearchParams({ clientId: id }).toString()}`,
  );
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
  // `data` may still hold the previous client's invoices while a new id loads.
  const clientInvoices = invoices.loading ? undefined : invoices.data?.data;
  const invoicingReady = invoiceConfig.data?.data.configured === true;

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
              {/* Until the plan list arrives the select would otherwise show "No plan". */}
              {client.planId !== null && !currentPlan && (
                <option value={client.planId}>{plans.error ? 'Unknown plan' : 'Loading…'}</option>
              )}
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

      <h2 className="section-title">
        Invoices
        {clientInvoices && <span className="count">{clientInvoices.length}</span>}
        {invoicingReady && (
          <Link to={`/clients/${client.id}/invoices/new`} className="button-ghost section-action">
            New invoice
          </Link>
        )}
      </h2>
      {invoiceConfig.data && !invoiceConfig.data.data.configured ? (
        <p className="notice">{notConfiguredMessage}</p>
      ) : invoices.error ? (
        <p className="notice notice--error">Failed to load invoices: {invoices.error.message}</p>
      ) : !clientInvoices ? (
        <p className="notice">Loading…</p>
      ) : clientInvoices.length === 0 ? (
        <p className="notice">No invoices for this client yet.</p>
      ) : (
        <ul className="link-list">
          {clientInvoices.map((invoice) => (
            <li key={invoice.id}>
              <Link to={`/invoices/${encodeURIComponent(invoice.id)}`}>
                {invoice.number ?? invoice.id}
              </Link>
              <span className="muted">{formatDateOnly(invoice.date)}</span>
              <span className="num">{formatUsd(invoice.total)}</span>
              <InvoiceStatusBadge invoice={invoice} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

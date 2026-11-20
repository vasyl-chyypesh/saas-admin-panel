import { type FormEvent, type JSX, useId, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  type ApiError,
  type FieldErrors,
  newIdempotencyKey,
  sendJson,
  toApiError,
  useFetchJson,
} from '../../lib/api.ts';
import { parseAmount, toAmountInput } from '../../lib/money.ts';
import { type Client, type ClientResponse, clientStatusLabels } from '../client/client.shared.tsx';
import type { Plan, PlanListResponse } from '../plan/plan.shared.tsx';
import {
  addDaysIso,
  type CreateInvoiceBody,
  formatUsd,
  type InvoiceConfigResponse,
  type InvoiceResponse,
  notConfiguredMessage,
  TestModeBadge,
  todayIso,
} from './invoice.shared.tsx';

type Period = 'monthly' | 'yearly';

interface LineDraft {
  /** Stable React key; lines can be removed from the middle. */
  key: string;
  description: string;
  quantity: string;
  /** As typed, in dollars ("49.00"). */
  unitPrice: string;
}

interface FormValues {
  period: Period;
  date: string;
  dueDate: string;
  lines: LineDraft[];
  /** As typed, in dollars; blank means no tax. */
  tax: string;
  note: string;
}

const DEFAULT_TERMS_DAYS = 14;
const MAX_LINES = 20;

let lineCounter = 0;
const emptyLine = (): LineDraft => ({
  key: `line-${++lineCounter}`,
  description: '',
  quantity: '1',
  unitPrice: '',
});

const monthYear = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "Pro plan — November 2026" or "Pro plan — 12 months from November 2026". */
const planLineDescription = (plan: Plan, period: Period, date: string): string => {
  const month = monthYear.format(new Date(`${date}T00:00:00Z`));
  return `${plan.name} plan — ${period === 'monthly' ? month : `12 months from ${month}`}`;
};

/** The first line, prefilled from the plan; `undefined` when the plan has no published price. */
const planLine = (plan: Plan | undefined, period: Period, date: string): LineDraft | undefined => {
  const price = plan?.prices[period];
  if (!plan || price === null || price === undefined) return undefined;
  return {
    ...emptyLine(),
    description: planLineDescription(plan, period, date),
    unitPrice: toAmountInput(price, plan.currency),
  };
};

const initialValues = (plan: Plan | undefined): FormValues => {
  const date = todayIso();
  return {
    period: 'monthly',
    date,
    dueDate: addDaysIso(date, DEFAULT_TERMS_DAYS),
    lines: [planLine(plan, 'monthly', date) ?? emptyLine()],
    tax: '',
    note: '',
  };
};

interface ParsedLine {
  description: string;
  quantity: number;
  unitPrice: number;
}

/** Parses a line, or returns the message to show under it. */
const parseLine = (line: LineDraft): ParsedLine | string => {
  const description = line.description.trim();
  if (description === '') return 'Add a description';
  const quantity = Number(line.quantity);
  if (!/^\d+$/.test(line.quantity.trim()) || quantity < 1 || quantity > 10_000) {
    return 'Quantity must be a whole number from 1 to 10000';
  }
  const unitPrice = parseAmount(line.unitPrice, 'USD');
  if (unitPrice === undefined) return 'Enter a price like 49 or 49.99';
  return { description, quantity, unitPrice };
};

interface InvoiceFormProps {
  client: Client;
  plan: Plan | undefined;
}

const InvoiceForm = ({ client, plan }: InvoiceFormProps): JSX.Element => {
  const id = useId();
  const navigate = useNavigate();
  const [values, setValues] = useState<FormValues>(() => initialValues(plan));
  /**
   * One key per distinct submission: kept across a retry of the same form (so a request that timed
   * out but reached Oncade isn't created twice), replaced on any edit.
   */
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [lineErrors, setLineErrors] = useState<Partial<Record<string, string>>>({});
  const [localErrors, setLocalErrors] = useState<FieldErrors>({});
  const [apiError, setApiError] = useState<ApiError>();
  const [saving, setSaving] = useState(false);

  const update = (change: (prev: FormValues) => FormValues): void => {
    setValues(change);
    setIdempotencyKey(newIdempotencyKey());
  };

  const updateLine = (key: string, field: keyof Omit<LineDraft, 'key'>, value: string): void => {
    update((prev) => ({
      ...prev,
      lines: prev.lines.map((line) => (line.key === key ? { ...line, [field]: value } : line)),
    }));
  };

  /** Switching period refills the first line from the plan; other lines are untouched. */
  const setPeriod = (period: Period): void => {
    update((prev) => {
      const refill = planLine(plan, period, prev.date);
      const [, ...rest] = prev.lines;
      return { ...prev, period, lines: refill ? [refill, ...rest] : prev.lines };
    });
  };

  const errorFor = (field: string): string | undefined =>
    localErrors[field]?.[0] ?? apiError?.details[field]?.[0];

  const fieldProps = (field: string) => {
    const error = errorFor(field);
    return {
      id: `${id}-${field}`,
      'aria-invalid': error !== undefined,
      ...(error !== undefined && { 'aria-describedby': `${id}-${field}-error` }),
    };
  };

  const fieldError = (field: string): JSX.Element | null => {
    const error = errorFor(field);
    return error === undefined ? null : (
      <span id={`${id}-${field}-error`} className="field-error">
        {error}
      </span>
    );
  };

  const parsedLines = values.lines.map(parseLine);
  const subtotal = parsedLines.reduce(
    (sum, line) => (typeof line === 'string' ? sum : sum + line.quantity * line.unitPrice),
    0,
  );
  const tax = values.tax.trim() === '' ? 0 : parseAmount(values.tax, 'USD');

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();

    const nextLineErrors: Partial<Record<string, string>> = {};
    const items: ParsedLine[] = [];
    values.lines.forEach((line, index) => {
      const parsed = parsedLines[index];
      if (typeof parsed === 'string') nextLineErrors[line.key] = parsed;
      else if (parsed) items.push(parsed);
    });
    const errors: FieldErrors = {};
    if (tax === undefined) errors['tax'] = ['Enter tax like 4 or 4.50, or leave it blank'];
    if (values.dueDate < values.date) {
      errors['dueDate'] = ['Due date must be on or after the invoice date'];
    }

    setLineErrors(nextLineErrors);
    setLocalErrors(errors);
    setApiError(undefined);
    if (Object.keys(nextLineErrors).length > 0 || Object.keys(errors).length > 0) return;

    const note = values.note.trim();
    const body: CreateInvoiceBody = {
      clientId: client.id,
      date: values.date,
      dueDate: values.dueDate,
      items,
      ...(tax !== undefined && tax > 0 && { tax }),
      ...(note !== '' && { note }),
    };

    setSaving(true);
    try {
      const res = await sendJson<InvoiceResponse>('POST', '/api/invoices', body, {
        'Idempotency-Key': idempotencyKey,
      });
      await navigate(`/invoices/${encodeURIComponent(res.data.id)}`, { replace: true });
    } catch (err) {
      setApiError(toApiError(err));
      setSaving(false);
    }
  };

  // Errors with no field (network failure, Oncade rejection, 503) have nowhere inline to go.
  const formError =
    apiError && Object.keys(apiError.details).length === 0
      ? apiError.status === 503
        ? notConfiguredMessage
        : apiError.message
      : undefined;
  const pricedPlan = plan && plan.prices.monthly !== null ? plan : undefined;

  return (
    <form
      className="form form--wide"
      noValidate
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
    >
      {formError !== undefined && (
        <p className="notice notice--error" role="alert">
          {formError}
        </p>
      )}

      <dl className="details">
        <dt>Bill to</dt>
        <dd>
          <div className="cell-stack">
            <span>{client.company}</span>
            <span className="muted">{client.email}</span>
          </div>
        </dd>
        <dt>Plan</dt>
        <dd>
          {plan ? plan.name : <span className="muted">No plan</span>}
          {plan && !pricedPlan && (
            <span className="muted"> · custom pricing, enter lines below</span>
          )}
        </dd>
      </dl>
      {client.status === 'suspended' || client.status === 'churned' ? (
        <p className="hint">This client is {clientStatusLabels[client.status].toLowerCase()}.</p>
      ) : null}

      <div className="field-row">
        {pricedPlan && (
          <div className="field">
            <label htmlFor={`${id}-period`}>Billing period</label>
            <select
              id={`${id}-period`}
              className="input"
              value={values.period}
              onChange={(e) => {
                setPeriod(e.target.value === 'yearly' ? 'yearly' : 'monthly');
              }}
            >
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
            <span className="hint">Refills the first line from the plan.</span>
          </div>
        )}
        <div className="field">
          <label htmlFor={`${id}-date`}>Invoice date</label>
          <input
            {...fieldProps('date')}
            type="date"
            className="input"
            value={values.date}
            required
            onChange={(e) => {
              const date = e.target.value;
              update((prev) => ({ ...prev, date }));
            }}
          />
          {fieldError('date')}
        </div>
        <div className="field">
          <label htmlFor={`${id}-dueDate`}>Due date</label>
          <input
            {...fieldProps('dueDate')}
            type="date"
            className="input"
            value={values.dueDate}
            min={values.date}
            required
            onChange={(e) => {
              const dueDate = e.target.value;
              update((prev) => ({ ...prev, dueDate }));
            }}
          />
          {fieldError('dueDate')}
        </div>
      </div>

      <fieldset className="field">
        <legend>Lines</legend>
        <div className="line-items">
          <div className="line-item line-item--head" aria-hidden="true">
            <span>Description</span>
            <span>Qty</span>
            <span>Unit price ($)</span>
            <span />
          </div>
          {values.lines.map((line, index) => {
            const error = lineErrors[line.key];
            const errorId = `${id}-${line.key}-error`;
            const describedBy = error === undefined ? {} : { 'aria-describedby': errorId };
            return (
              <div key={line.key} className="line-item-row">
                <div className="line-item">
                  <input
                    className="input"
                    aria-label={`Line ${index + 1} description`}
                    aria-invalid={error !== undefined}
                    {...describedBy}
                    value={line.description}
                    maxLength={200}
                    onChange={(e) => {
                      updateLine(line.key, 'description', e.target.value);
                    }}
                  />
                  <input
                    className="input input--num"
                    aria-label={`Line ${index + 1} quantity`}
                    aria-invalid={error !== undefined}
                    {...describedBy}
                    inputMode="numeric"
                    value={line.quantity}
                    onChange={(e) => {
                      updateLine(line.key, 'quantity', e.target.value);
                    }}
                  />
                  <input
                    className="input input--num"
                    aria-label={`Line ${index + 1} unit price in dollars`}
                    aria-invalid={error !== undefined}
                    {...describedBy}
                    inputMode="decimal"
                    placeholder="0.00"
                    value={line.unitPrice}
                    onChange={(e) => {
                      updateLine(line.key, 'unitPrice', e.target.value);
                    }}
                  />
                  <button
                    type="button"
                    className="button-link"
                    aria-label={`Remove line ${index + 1}`}
                    disabled={values.lines.length === 1}
                    onClick={() => {
                      update((prev) => ({
                        ...prev,
                        lines: prev.lines.filter((l) => l.key !== line.key),
                      }));
                    }}
                  >
                    Remove
                  </button>
                </div>
                {error !== undefined && (
                  <span id={errorId} className="field-error">
                    {error}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {fieldError('items')}
        <div>
          <button
            type="button"
            className="button-ghost"
            disabled={values.lines.length >= MAX_LINES}
            onClick={() => {
              update((prev) => ({ ...prev, lines: [...prev.lines, emptyLine()] }));
            }}
          >
            Add line
          </button>
        </div>
      </fieldset>

      <div className="field-row">
        <div className="field">
          <label htmlFor={`${id}-tax`}>Tax ($)</label>
          <input
            {...fieldProps('tax')}
            className="input input--num"
            inputMode="decimal"
            placeholder="0.00"
            value={values.tax}
            onChange={(e) => {
              const taxValue = e.target.value;
              update((prev) => ({ ...prev, tax: taxValue }));
            }}
          />
          {fieldError('tax')}
        </div>
        <div className="field">
          <span className="field-label">Invoice total</span>
          <output className="invoice-total" htmlFor={`${id}-tax`}>
            {formatUsd(subtotal + (tax ?? 0))}
          </output>
          <span className="hint">Oncade adds its fee on top; the client pays it.</span>
        </div>
      </div>

      <div className="field">
        <label htmlFor={`${id}-note`}>Note to the client</label>
        <textarea
          {...fieldProps('note')}
          className="input"
          rows={3}
          maxLength={1000}
          value={values.note}
          onChange={(e) => {
            const note = e.target.value;
            update((prev) => ({ ...prev, note }));
          }}
        />
        {fieldError('note')}
      </div>

      <div className="form-actions">
        <button type="submit" className="button-primary" disabled={saving}>
          {saving ? 'Creating…' : 'Create draft'}
        </button>
        <span className="hint">
          Nothing is emailed yet. You&apos;ll review Oncade&apos;s totals before sending.
        </span>
      </div>
    </form>
  );
};

export const InvoiceCreatePage = (): JSX.Element => {
  const { id = '' } = useParams();
  const clientUrl = `/api/clients/${encodeURIComponent(id)}`;
  const client = useFetchJson<ClientResponse>(clientUrl);
  const config = useFetchJson<InvoiceConfigResponse>('/api/invoices/config');
  // The whole list, as on the client page: it also covers clients with no plan, without a request
  // that depends on the client loading first.
  const plans = useFetchJson<PlanListResponse>('/api/plans');

  const backLink = (
    <Link to={`/clients/${encodeURIComponent(id)}`} className="back-link">
      ← Back to client
    </Link>
  );

  const shell = (body: JSX.Element): JSX.Element => (
    <section>
      <title>New invoice · SaaS Admin Panel</title>
      {backLink}
      <header className="page-header">
        <h1>New invoice</h1>
        <TestModeBadge config={config.data?.data} />
      </header>
      {body}
    </section>
  );

  if (client.error) {
    const notFound = client.error.status === 404 || client.error.status === 400;
    return shell(
      <p className="notice notice--error">
        {notFound ? 'Client not found.' : `Failed to load client: ${client.error.message}`}
      </p>,
    );
  }
  if (config.error) {
    return shell(
      <p className="notice notice--error">
        Failed to load invoicing settings: {config.error.message}
      </p>,
    );
  }
  if (config.data && !config.data.data.configured) {
    return shell(<p className="notice notice--error">{notConfiguredMessage}</p>);
  }
  // A failed plan list only loses the prefill; the admin can still type the lines.
  if (client.loading || !client.data || !config.data || (!plans.data && !plans.error)) {
    return shell(<p className="notice">Loading…</p>);
  }

  const clientPlan = plans.data?.data.find((plan) => plan.id === client.data?.data.planId);
  return shell(
    // Keyed by client and plan, so the prefill is recomputed if either changes.
    <InvoiceForm
      key={`${client.data.data.id}:${clientPlan?.id ?? 'none'}`}
      client={client.data.data}
      plan={clientPlan}
    />,
  );
};

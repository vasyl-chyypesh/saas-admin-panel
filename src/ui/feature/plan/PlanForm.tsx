import { type FormEvent, type JSX, useId, useState } from 'react';
import { type ApiError, type FieldErrors, toApiError } from '../../lib/api.ts';
import { minorUnitDigits, parseAmount, toAmountInput } from '../../lib/money.ts';
import type { Plan, PlanPrices } from './plan.shared.tsx';

/** Everything the form edits; the page picks the fields its request accepts. */
export interface PlanDraft {
  code: string;
  name: string;
  description: string;
  currency: Plan['currency'];
  prices: PlanPrices;
  archived: boolean;
}

interface FormValues {
  code: string;
  name: string;
  description: string;
  currency: Plan['currency'];
  /** Prices as typed, in major units ("49.00"). */
  monthly: string;
  yearly: string;
  /** Both prices `null`: the plan is quoted by sales. */
  customPricing: boolean;
  archived: boolean;
}

const toFormValues = (plan: Plan | undefined): FormValues =>
  plan
    ? {
        code: plan.code,
        name: plan.name,
        description: plan.description,
        currency: plan.currency,
        monthly: toAmountInput(plan.prices.monthly, plan.currency),
        yearly: toAmountInput(plan.prices.yearly, plan.currency),
        customPricing: plan.prices.monthly === null && plan.prices.yearly === null,
        archived: plan.archived,
      }
    : {
        code: '',
        name: '',
        description: '',
        currency: 'USD',
        monthly: '',
        yearly: '',
        customPricing: false,
        archived: false,
      };

interface PlanFormProps {
  /** The plan being edited, or `undefined` when creating one. */
  plan: Plan | undefined;
  submitLabel: string;
  /** Should throw (an `ApiError`, ideally) when saving fails; the form shows the error. */
  onSubmit: (draft: PlanDraft) => Promise<void>;
}

export const PlanForm = ({ plan, submitLabel, onSubmit }: PlanFormProps): JSX.Element => {
  const id = useId();
  const editing = plan !== undefined;
  const [values, setValues] = useState<FormValues>(() => toFormValues(plan));
  const [localErrors, setLocalErrors] = useState<FieldErrors>({});
  const [apiError, setApiError] = useState<ApiError>();
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]): void => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const errorFor = (field: string): string | undefined =>
    localErrors[field]?.[0] ?? apiError?.details[field]?.[0];

  /** Wires an input to its label and error message. */
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

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();

    const errors: FieldErrors = {};
    let prices: PlanPrices = { monthly: null, yearly: null };
    if (!values.customPricing) {
      const monthly = parseAmount(values.monthly, values.currency);
      const yearly = parseAmount(values.yearly, values.currency);
      if (monthly === undefined || yearly === undefined) {
        errors['prices'] =
          minorUnitDigits(values.currency) === 0
            ? ['Enter whole amounts, e.g. 4900']
            : ['Enter amounts like 49 or 49.99'];
      } else {
        prices = { monthly, yearly };
      }
    }

    setLocalErrors(errors);
    setApiError(undefined);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    try {
      await onSubmit({
        code: values.code.trim(),
        name: values.name,
        description: values.description,
        currency: values.currency,
        prices,
        archived: values.archived,
      });
    } catch (err) {
      setApiError(toApiError(err));
    } finally {
      setSaving(false);
    }
  };

  // Errors with no field (network failure, 500, unknown key) have nowhere inline to go.
  const formError =
    apiError && Object.keys(apiError.details).length === 0 ? apiError.message : undefined;

  return (
    <form
      className="form"
      noValidate
      onSubmit={(e) => {
        void handleSubmit(e);
      }}
    >
      {formError !== undefined && <p className="notice notice--error">{formError}</p>}

      <div className="field-row">
        <div className="field">
          <label htmlFor={`${id}-name`}>Name</label>
          <input
            {...fieldProps('name')}
            className="input"
            value={values.name}
            maxLength={60}
            required
            onChange={(e) => {
              set('name', e.target.value);
            }}
          />
          {fieldError('name')}
        </div>

        <div className="field">
          <label htmlFor={`${id}-code`}>Code</label>
          <input
            {...fieldProps('code')}
            className="input input--mono"
            value={values.code}
            maxLength={40}
            readOnly={editing}
            spellCheck={false}
            autoCapitalize="none"
            onChange={(e) => {
              set('code', e.target.value.toLowerCase());
            }}
          />
          {fieldError('code')}
          <span className="hint">
            {editing
              ? 'Fixed once the plan exists.'
              : 'Lowercase letters, digits and hyphens, e.g. pro. Cannot be changed later.'}
          </span>
        </div>
      </div>

      <div className="field">
        <label htmlFor={`${id}-description`}>Description</label>
        <textarea
          {...fieldProps('description')}
          className="input"
          value={values.description}
          maxLength={500}
          rows={3}
          onChange={(e) => {
            set('description', e.target.value);
          }}
        />
        {fieldError('description')}
      </div>

      <fieldset className="field">
        <legend>Pricing</legend>
        <div className="field-row">
          <div className="field">
            <label htmlFor={`${id}-currency`}>Currency</label>
            <input
              {...fieldProps('currency')}
              className="input input--mono"
              value={values.currency}
              readOnly
            />
            {fieldError('currency')}
            <span className="hint">Invoices are billed in USD only.</span>
          </div>
          <div className="field">
            <label htmlFor={`${id}-monthly`}>Monthly</label>
            <input
              id={`${id}-monthly`}
              className="input input--num"
              inputMode="decimal"
              value={values.customPricing ? '' : values.monthly}
              placeholder={values.customPricing ? 'Custom' : '0.00'}
              disabled={values.customPricing}
              aria-invalid={errorFor('prices') !== undefined}
              {...(errorFor('prices') !== undefined && {
                'aria-describedby': `${id}-prices-error`,
              })}
              onChange={(e) => {
                set('monthly', e.target.value);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor={`${id}-yearly`}>Yearly</label>
            <input
              id={`${id}-yearly`}
              className="input input--num"
              inputMode="decimal"
              value={values.customPricing ? '' : values.yearly}
              placeholder={values.customPricing ? 'Custom' : '0.00'}
              disabled={values.customPricing}
              aria-invalid={errorFor('prices') !== undefined}
              {...(errorFor('prices') !== undefined && {
                'aria-describedby': `${id}-prices-error`,
              })}
              onChange={(e) => {
                set('yearly', e.target.value);
              }}
            />
          </div>
        </div>
        {fieldError('prices')}
        <label className="checkbox">
          <input
            type="checkbox"
            checked={values.customPricing}
            onChange={(e) => {
              set('customPricing', e.target.checked);
            }}
          />
          Custom pricing (contact sales)
        </label>
      </fieldset>

      {editing && (
        <div className="field">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={values.archived}
              onChange={(e) => {
                set('archived', e.target.checked);
              }}
            />
            Archived
          </label>
          {fieldError('archived')}
          <span className="hint">
            Clients already on an archived plan keep it, but it can't be attached to new ones.
          </span>
        </div>
      )}

      <div className="form-actions">
        <button type="submit" className="button-primary" disabled={saving}>
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
};

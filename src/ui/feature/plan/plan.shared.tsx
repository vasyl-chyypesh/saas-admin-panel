import type { JSX } from 'react';
// Type-only import: erased at build, so zod never reaches the UI bundle.
import type {
  CreatePlanBody,
  Plan,
  PlanPrices,
  UpdatePlanBody,
} from '../../../api/feature/plan/plan.schema.ts';

export type { CreatePlanBody, Plan, PlanPrices, UpdatePlanBody };

export interface PlanListResponse {
  data: Plan[];
  total: number;
}

export interface PlanResponse {
  data: Plan;
}

/**
 * Digits in the currency's minor unit: 2 for USD (cents), 0 for JPY. Prices are stored in minor
 * units, so this is the scale between the stored integer and what people type and read.
 */
export const minorUnitDigits = (currency: string): number => {
  try {
    return (
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    // Not a well-formed currency code (e.g. half-typed in the form).
    return 2;
  }
};

/** `4900, 'USD'` → `$49.00`; `null` → `Custom` (the price is quoted by sales). */
export const formatPrice = (amount: number | null, currency: string): string => {
  if (amount === null) return 'Custom';
  const major = amount / 10 ** minorUnitDigits(currency);
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(major);
  } catch {
    return `${major.toFixed(minorUnitDigits(currency))} ${currency}`;
  }
};

export const PlanStatus = ({ archived }: { archived: boolean }): JSX.Element => (
  <span className={`status status--${archived ? 'archived' : 'active'}`}>
    {archived ? 'Archived' : 'Active'}
  </span>
);

import { randomUUID } from 'node:crypto';
import {
  type CreatePlanInput,
  type ListPlansQuery,
  type Plan,
  planSchema,
  type UpdatePlanInput,
} from './plan.schema.ts';

/**
 * In-memory mock data until a real database exists. Parsed at import so a typo fails at boot.
 * Writes change this array, so they last until the process restarts.
 */
const plans: Plan[] = planSchema.array().parse([
  {
    id: '4d5e4056-7b48-40e1-b9a8-ac89742caf67',
    code: 'lite',
    name: 'Lite',
    description: 'For solo founders getting started: 1 seat, 1,000 contacts and email support.',
    currency: 'USD',
    prices: { monthly: 1900, yearly: 19000 },
    archived: false,
    createdAt: '2024-05-01T09:00:00.000Z',
    updatedAt: '2026-01-10T12:00:00.000Z',
  },
  {
    id: 'c1e964af-952e-49cb-b6fe-4eeab545542b',
    code: 'pro',
    name: 'Pro',
    description: 'For growing teams: 10 seats, 25,000 contacts, API access and priority support.',
    currency: 'USD',
    prices: { monthly: 4900, yearly: 49000 },
    archived: false,
    createdAt: '2024-05-01T09:00:00.000Z',
    updatedAt: '2026-01-10T12:00:00.000Z',
  },
  {
    id: '854148f1-0ab5-4a53-a56a-1d2fa4d43cc1',
    code: 'enterprise',
    name: 'Enterprise',
    description:
      'Unlimited seats and contacts, SSO, audit log, an SLA and a dedicated success manager.',
    currency: 'USD',
    prices: { monthly: null, yearly: null },
    archived: false,
    createdAt: '2024-05-01T09:00:00.000Z',
    updatedAt: '2025-08-22T15:30:00.000Z',
  },
  {
    id: '7adb0946-f786-4434-bdf1-221b0a104fff',
    code: 'starter-2024',
    name: 'Starter (2024)',
    description: 'Legacy plan replaced by Lite. Kept for the customers already on it.',
    currency: 'USD',
    prices: { monthly: 900, yearly: 9000 },
    archived: true,
    createdAt: '2024-01-15T09:00:00.000Z',
    updatedAt: '2026-01-10T12:00:00.000Z',
  },
]);

/**
 * Active plans before archived ones, then cheapest first by monthly price with unpublished (`null`)
 * prices last, then by name.
 */
const byListOrder = (a: Plan, b: Plan): number =>
  Number(a.archived) - Number(b.archived) ||
  // Infinity - Infinity is NaN, which is falsy, so two `null` prices fall through to the name.
  (a.prices.monthly ?? Infinity) - (b.prices.monthly ?? Infinity) ||
  a.name.localeCompare(b.name);

export const listPlans = ({ archived }: ListPlansQuery = {}): Plan[] =>
  plans
    .filter((plan) => archived === undefined || plan.archived === archived)
    .toSorted(byListOrder);

export const getPlanById = (id: string): Plan | undefined => plans.find((plan) => plan.id === id);

export const isPlanCodeTaken = (code: string): boolean => plans.some((plan) => plan.code === code);

export const createPlan = (input: CreatePlanInput): Plan => {
  const now = new Date().toISOString();
  const plan = planSchema.parse({
    ...input,
    id: randomUUID(),
    archived: false,
    createdAt: now,
    updatedAt: now,
  });
  plans.push(plan);
  return plan;
};

/** Returns `undefined` for an unknown id. Records are replaced, never mutated in place. */
export const updatePlan = (id: string, changes: UpdatePlanInput): Plan | undefined => {
  const index = plans.findIndex((plan) => plan.id === id);
  const current = plans[index];
  if (!current) return undefined;

  // Re-parsing the merged record keeps the stored shape valid and drops `undefined` keys.
  const updated = planSchema.parse({
    ...current,
    ...changes,
    updatedAt: new Date().toISOString(),
  });
  plans[index] = updated;
  return updated;
};

import { AppError } from '../../lib/errors.ts';
import type { CreatePlanInput, ListPlansQuery, Plan, UpdatePlanInput } from './plan.schema.ts';
import * as planStorage from './plan.storage.ts';

/**
 * Plan rules. Takes parsed input and returns records; failures are thrown as `AppError`. Other
 * features use plans only through this module, never through `plan.storage.ts`. The one exception
 * is the boot check on mock data in `client.storage.ts`.
 */

export const listPlans = (query: ListPlansQuery): Plan[] => planStorage.listPlans(query);

/** For other features checking a plan they were given; `undefined` when it does not exist. */
export const findPlan = (id: string): Plan | undefined => planStorage.getPlanById(id);

export const getPlan = (id: string): Plan => {
  const plan = planStorage.getPlanById(id);
  if (!plan) throw new AppError('not-found', 'Plan not found');
  return plan;
};

/** `code` is unique across all plans, archived ones included. */
export const createPlan = (input: CreatePlanInput): Plan => {
  if (planStorage.isPlanCodeTaken(input.code)) {
    throw new AppError('conflict', `Plan code "${input.code}" is already in use`, {
      field: 'code',
    });
  }
  return planStorage.createPlan(input);
};

export const updatePlan = (id: string, changes: UpdatePlanInput): Plan => {
  const plan = planStorage.updatePlan(id, changes);
  if (!plan) throw new AppError('not-found', 'Plan not found');
  return plan;
};

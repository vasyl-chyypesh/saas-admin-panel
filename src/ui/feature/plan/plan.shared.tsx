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

export const PlanStatus = ({ archived }: { archived: boolean }): JSX.Element => (
  <span className={`status status--${archived ? 'archived' : 'active'}`}>
    {archived ? 'Archived' : 'Active'}
  </span>
);

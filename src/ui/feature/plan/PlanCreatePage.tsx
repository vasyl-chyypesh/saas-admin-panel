import type { JSX } from 'react';
import { Link, useNavigate } from 'react-router';
import { sendJson } from '../../lib/api.ts';
import { type CreatePlanBody, type PlanResponse } from './plan.shared.tsx';
import { type PlanDraft, PlanForm } from './PlanForm.tsx';

export const PlanCreatePage = (): JSX.Element => {
  const navigate = useNavigate();

  const create = async ({ code, name, description, currency, prices }: PlanDraft) => {
    const body: CreatePlanBody = { code, name, description, currency, prices };
    const res = await sendJson<PlanResponse>('POST', '/api/plans', body);
    await navigate(`/plans/${res.data.id}`, { replace: true });
  };

  return (
    <section>
      <title>New plan · SaaS Admin Panel</title>
      <Link to="/plans" className="back-link">
        ← All plans
      </Link>
      <header className="page-header">
        <h1>New plan</h1>
      </header>
      <PlanForm plan={undefined} submitLabel="Create plan" onSubmit={create} />
    </section>
  );
};

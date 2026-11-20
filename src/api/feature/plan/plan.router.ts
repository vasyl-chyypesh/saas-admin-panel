import { Router } from 'express';
import { sendFieldError, sendNotFound, sendValidationError } from '../../lib/http.ts';
import {
  createPlanSchema,
  listPlansQuerySchema,
  planIdParamsSchema,
  updatePlanSchema,
} from './plan.schema.ts';
import { createPlan, getPlanById, isPlanCodeTaken, listPlans, updatePlan } from './plan.storage.ts';

export const planRouter: Router = Router();

planRouter.get('/', (req, res) => {
  const query = listPlansQuerySchema.safeParse(req.query);
  if (!query.success) {
    sendValidationError(res, query.error);
    return;
  }

  const data = listPlans(query.data);
  res.json({ data, total: data.length });
});

planRouter.post('/', (req, res) => {
  const body = createPlanSchema.safeParse(req.body);
  if (!body.success) {
    sendValidationError(res, body.error);
    return;
  }

  if (isPlanCodeTaken(body.data.code)) {
    sendFieldError(res, 409, 'code', `Plan code "${body.data.code}" is already in use`);
    return;
  }

  const plan = createPlan(body.data);
  res.status(201).location(`/api/plans/${plan.id}`).json({ data: plan });
});

planRouter.get('/:id', (req, res) => {
  const params = planIdParamsSchema.safeParse(req.params);
  if (!params.success) {
    sendValidationError(res, params.error);
    return;
  }

  const plan = getPlanById(params.data.id);
  if (!plan) {
    sendNotFound(res, 'Plan not found');
    return;
  }

  res.json({ data: plan });
});

planRouter.patch('/:id', (req, res) => {
  const params = planIdParamsSchema.safeParse(req.params);
  if (!params.success) {
    sendValidationError(res, params.error);
    return;
  }

  const body = updatePlanSchema.safeParse(req.body);
  if (!body.success) {
    sendValidationError(res, body.error);
    return;
  }

  if (Object.keys(body.data).length === 0) {
    res.status(400).json({
      error: 'Bad Request',
      message: 'Request body must include at least one field to update',
      details: {},
    });
    return;
  }

  const plan = updatePlan(params.data.id, body.data);
  if (!plan) {
    sendNotFound(res, 'Plan not found');
    return;
  }

  res.json({ data: plan });
});

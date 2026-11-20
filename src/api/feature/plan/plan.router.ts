import { Router } from 'express';
import { parseOrThrow } from '../../lib/http.ts';
import {
  createPlanSchema,
  listPlansQuerySchema,
  planIdParamsSchema,
  updatePlanSchema,
} from './plan.schema.ts';
import * as planService from './plan.service.ts';

/** HTTP only: parse the request, call the service, shape the response. Errors go to `errorHandler`. */
export const planRouter: Router = Router();

planRouter.get('/', (req, res) => {
  const query = parseOrThrow(listPlansQuerySchema, req.query);
  const data = planService.listPlans(query);
  res.json({ data, total: data.length });
});

planRouter.post('/', (req, res) => {
  const body = parseOrThrow(createPlanSchema, req.body);
  const plan = planService.createPlan(body);
  res.status(201).location(`/api/plans/${plan.id}`).json({ data: plan });
});

planRouter.get('/:id', (req, res) => {
  const { id } = parseOrThrow(planIdParamsSchema, req.params);
  res.json({ data: planService.getPlan(id) });
});

planRouter.patch('/:id', (req, res) => {
  const { id } = parseOrThrow(planIdParamsSchema, req.params);
  const changes = parseOrThrow(updatePlanSchema, req.body);
  res.json({ data: planService.updatePlan(id, changes) });
});

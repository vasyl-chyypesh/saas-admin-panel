import { Router } from 'express';
import { sendFieldError, sendNotFound, sendValidationError } from '../../lib/http.ts';
import { getPlanById } from '../plan/plan.storage.ts';
import {
  clientIdParamsSchema,
  listClientsQuerySchema,
  updateClientSchema,
} from './client.schema.ts';
import { getClientById, listClients, setClientPlan } from './client.storage.ts';

export const clientRouter: Router = Router();

clientRouter.get('/', (req, res) => {
  const query = listClientsQuerySchema.safeParse(req.query);
  if (!query.success) {
    sendValidationError(res, query.error);
    return;
  }

  const data = listClients(query.data);
  res.json({ data, total: data.length });
});

clientRouter.get('/:id', (req, res) => {
  const params = clientIdParamsSchema.safeParse(req.params);
  if (!params.success) {
    sendValidationError(res, params.error);
    return;
  }

  const client = getClientById(params.data.id);
  if (!client) {
    sendNotFound(res, 'Client not found');
    return;
  }

  res.json({ data: client });
});

clientRouter.patch('/:id', (req, res) => {
  const params = clientIdParamsSchema.safeParse(req.params);
  if (!params.success) {
    sendValidationError(res, params.error);
    return;
  }

  const body = updateClientSchema.safeParse(req.body);
  if (!body.success) {
    sendValidationError(res, body.error);
    return;
  }

  const client = getClientById(params.data.id);
  if (!client) {
    sendNotFound(res, 'Client not found');
    return;
  }

  const { planId } = body.data;
  // Re-sending the current plan is a no-op, which also lets a client keep an archived plan.
  if (planId === client.planId) {
    res.json({ data: client });
    return;
  }

  if (planId !== null) {
    const plan = getPlanById(planId);
    if (!plan) {
      sendFieldError(res, 400, 'planId', 'Plan not found');
      return;
    }
    if (plan.archived) {
      sendFieldError(res, 409, 'planId', `Plan "${plan.name}" is archived and cannot be attached`);
      return;
    }
  }

  res.json({ data: setClientPlan(client.id, planId) });
});

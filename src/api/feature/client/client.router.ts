import { Router } from 'express';
import { parseOrThrow } from '../../lib/http.ts';
import {
  clientIdParamsSchema,
  listClientsQuerySchema,
  updateClientSchema,
} from './client.schema.ts';
import * as clientService from './client.service.ts';

/** HTTP only: parse the request, call the service, shape the response. Errors go to `errorHandler`. */
export const clientRouter: Router = Router();

clientRouter.get('/', (req, res) => {
  const query = parseOrThrow(listClientsQuerySchema, req.query);
  const data = clientService.listClients(query);
  res.json({ data, total: data.length });
});

clientRouter.get('/:id', (req, res) => {
  const { id } = parseOrThrow(clientIdParamsSchema, req.params);
  res.json({ data: clientService.getClient(id) });
});

clientRouter.patch('/:id', (req, res) => {
  const { id } = parseOrThrow(clientIdParamsSchema, req.params);
  const { planId } = parseOrThrow(updateClientSchema, req.body);
  res.json({ data: clientService.setPlan(id, planId) });
});

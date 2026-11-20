import { type Response, Router } from 'express';
import { z } from 'zod';
import { clientIdParamsSchema, listClientsQuerySchema } from './client.schema.ts';
import { getClientById, listClients } from './client.storage.ts';

export const clientRouter: Router = Router();

const sendValidationError = (res: Response, error: z.ZodError): void => {
  res.status(400).json({
    error: 'Bad Request',
    details: z.flattenError(error).fieldErrors,
  });
};

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
    res.status(404).json({ error: 'Not Found', message: 'Client not found' });
    return;
  }

  res.json({ data: client });
});

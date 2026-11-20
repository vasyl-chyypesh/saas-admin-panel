import { Router } from 'express';
import { clientRouter } from '../feature/client/client.router.ts';
import { healthRouter } from './health.ts';

export const apiRouter: Router = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/clients', clientRouter);

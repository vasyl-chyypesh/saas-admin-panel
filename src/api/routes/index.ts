import { Router } from 'express';
import { clientRouter } from '../feature/client/client.router.ts';
import { planRouter } from '../feature/plan/plan.router.ts';
import { healthRouter } from './health.ts';

export const apiRouter: Router = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/clients', clientRouter);
apiRouter.use('/plans', planRouter);

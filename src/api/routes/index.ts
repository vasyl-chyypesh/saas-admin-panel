import { Router } from 'express';
import { healthRouter } from './health.ts';

export const apiRouter: Router = Router();

apiRouter.use('/health', healthRouter);

import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.ts';

/** Express identifies error handlers by arity, so all four params must stay. */
export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (res.headersSent) {
    next(err);
    return;
  }

  const message = err instanceof Error ? err.message : 'Internal Server Error';
  console.error('[api] unhandled error:', err);

  res.status(500).json({
    error: 'Internal Server Error',
    ...(config.nodeEnv === 'development' ? { message } : {}),
  });
};

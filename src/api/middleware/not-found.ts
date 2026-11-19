import type { Request, Response } from 'express';

/** Terminal handler: anything that reaches it matched no route. */
export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({
    error: 'Not Found',
    method: req.method,
    path: req.originalUrl,
  });
};

import { existsSync } from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.ts';

const indexFile = path.join(config.uiDir, 'index.html');

/**
 * Hands non-API navigation requests to the built React bundle so client-side
 * routing works. Falls through to the 404 handler when the UI has not been
 * built yet (e.g. `npm run dev:api` alone, where Vite serves the UI instead).
 */
export const spaFallback = (req: Request, res: Response, next: NextFunction): void => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    next();
    return;
  }

  if (!existsSync(indexFile)) {
    next();
    return;
  }

  res.sendFile(indexFile, (err) => {
    if (err) next(err);
  });
};

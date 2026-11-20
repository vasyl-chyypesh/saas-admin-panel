import { STATUS_CODES } from 'node:http';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.ts';
import { sendKnownError } from '../lib/http.ts';

/** Fixed messages for the body parser's client errors, so its own wording never reaches clients. */
const clientErrorMessages: Partial<Record<string, string>> = {
  'entity.parse.failed': 'Malformed JSON body',
  'entity.too.large': 'Request body is too large',
  'encoding.unsupported': 'Unsupported request body encoding',
  'charset.unsupported': 'Unsupported request body charset',
};

/**
 * The 4xx status of an error that blames the request, such as `express.json()` failing to parse a
 * body (400) or a body over the size limit (413). Anything else is a server fault.
 */
const clientErrorStatus = (err: unknown): number | undefined => {
  if (typeof err !== 'object' || err === null || !('status' in err)) return undefined;
  const { status } = err;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : undefined;
};

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

  // Expected failures thrown by routes and services. Checked first: the 4xx branch below would
  // swallow the message of any error that happens to carry a `status`.
  if (sendKnownError(res, err)) return;

  const status = clientErrorStatus(err);
  if (status !== undefined) {
    const type =
      typeof err === 'object' && err !== null && 'type' in err && typeof err.type === 'string'
        ? err.type
        : '';
    const message = clientErrorMessages[type];
    res.status(status).json({
      error: STATUS_CODES[status] ?? 'Bad Request',
      ...(message !== undefined && { message }),
    });
    return;
  }

  const message = err instanceof Error ? err.message : 'Internal Server Error';
  console.error('[api] unhandled error:', err);

  res.status(500).json({
    error: 'Internal Server Error',
    ...(config.nodeEnv === 'development' ? { message } : {}),
  });
};

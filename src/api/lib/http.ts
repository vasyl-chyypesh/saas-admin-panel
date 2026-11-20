import { STATUS_CODES } from 'node:http';
import type { Response } from 'express';
import { z } from 'zod';
import { AppError, RequestValidationError } from './errors.ts';

/**
 * Parses one part of a request, or throws `RequestValidationError`, which `errorHandler` answers
 * with `sendValidationError`'s 400. Express 5 forwards the throw from sync and async handlers alike.
 */
export const parseOrThrow = <T extends z.ZodType>(schema: T, value: unknown): z.output<T> => {
  const result = schema.safeParse(value);
  if (!result.success) throw new RequestValidationError(result.error);
  return result.data;
};

/**
 * 400 for a failed `safeParse`. Errors on a field go to `details`; errors on the whole value (body
 * not an object, unknown keys under `z.strictObject`) have no field, so they become `message`.
 */
export const sendValidationError = (res: Response, error: z.ZodError): void => {
  const { formErrors, fieldErrors } = z.flattenError(error);
  res.status(400).json({
    error: 'Bad Request',
    ...(formErrors.length > 0 && { message: formErrors.join('; ') }),
    details: fieldErrors,
  });
};

/** An error tied to one input field, in the same `details` shape as `sendValidationError`. */
export const sendFieldError = (
  res: Response,
  status: 400 | 409,
  field: string,
  message: string,
): void => {
  res.status(status).json({
    error: status === 400 ? 'Bad Request' : 'Conflict',
    message,
    details: { [field]: [message] },
  });
};

export const sendNotFound = (res: Response, message: string): void => {
  res.status(404).json({ error: 'Not Found', message });
};

/** An error with no field, e.g. an upstream failure. `details` stays so clients parse one shape. */
export const sendError = (
  res: Response,
  status: 400 | 409 | 422 | 502 | 503,
  message: string,
): void => {
  res.status(status).json({ error: STATUS_CODES[status], message, details: {} });
};

const statusOf = {
  invalid: 400,
  conflict: 409,
  rejected: 422,
  upstream: 502,
  unavailable: 503,
} as const;

/** The response for a service's `AppError`. Called by `errorHandler`. */
export const sendAppError = (res: Response, err: AppError): void => {
  if (err.kind === 'not-found') {
    sendNotFound(res, err.message);
    return;
  }
  const status = statusOf[err.kind];
  if (err.field !== undefined && (status === 400 || status === 409)) {
    sendFieldError(res, status, err.field, err.message);
    return;
  }
  sendError(res, status, err.message);
};

/** Routes that throw `RequestValidationError` or `AppError` end up here via `errorHandler`. */
export const sendKnownError = (res: Response, err: unknown): boolean => {
  if (err instanceof RequestValidationError) {
    sendValidationError(res, err.zodError);
    return true;
  }
  if (err instanceof AppError) {
    sendAppError(res, err);
    return true;
  }
  return false;
};

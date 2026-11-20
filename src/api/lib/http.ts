import type { Response } from 'express';
import { z } from 'zod';

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

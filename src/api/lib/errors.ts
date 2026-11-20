import type { z } from 'zod';

/**
 * What went wrong, independent of HTTP. `sendAppError` in `http.ts` maps each kind to a status:
 *
 * - `invalid` → 400: the request refers to something unusable, e.g. an unknown plan id in a body
 * - `not-found` → 404: the resource named in the URL does not exist
 * - `conflict` → 409: valid input that clashes with current state (duplicate code, archived plan)
 * - `rejected` → 422: an upstream service refused the request (Oncade's other 4xx)
 * - `upstream` → 502: an upstream service failed or answered something we could not understand
 * - `unavailable` → 503: a dependency is not configured
 */
export type AppErrorKind =
  'invalid' | 'not-found' | 'conflict' | 'rejected' | 'upstream' | 'unavailable';

/**
 * An expected failure thrown by a service. `errorHandler` turns it into a response, so routes need
 * no `try/catch`. `message` reaches the client, so it must never quote a secret.
 *
 * Deliberately has no `status` property: `errorHandler` treats any error with a numeric 4xx
 * `status` as a body-parser error and replaces its message.
 */
export class AppError extends Error {
  readonly kind: AppErrorKind;
  /** The input field to blame, if any. It becomes the key in the response's `details`. */
  readonly field: string | undefined;

  constructor(kind: AppErrorKind, message: string, options?: { field?: string; cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.kind = kind;
    this.field = options?.field;
  }
}

/** A request part (params, query, body or a header) failed its zod schema. Answered with a 400. */
export class RequestValidationError extends Error {
  readonly zodError: z.ZodError;

  constructor(zodError: z.ZodError) {
    super('Invalid request');
    this.name = 'RequestValidationError';
    this.zodError = zodError;
  }
}

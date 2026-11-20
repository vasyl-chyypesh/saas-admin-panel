import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { captureConsole } from '../../helpers/console.ts';
import { setTestEnv } from '../../helpers/env.ts';

// `errorHandler` reads `config.nodeEnv`, so the environment is set before it is imported.
setTestEnv({ nodeEnv: 'production' });
const { errorHandler } = await import('../../../src/api/middleware/error-handler.ts');
const { AppError } = await import('../../../src/api/lib/errors.ts');
const { parseOrThrow } = await import('../../../src/api/lib/http.ts');

const logs = captureConsole();

/** A bare app whose routes throw the given error, with the real error handler behind them. */
const appThrowing = (err: unknown) => {
  const app = express();
  app.get('/sync', () => {
    throw err;
  });
  app.get('/async', async () => {
    await Promise.resolve();
    throw err;
  });
  app.use(errorHandler);
  return app;
};

const withProps = (message: string, props: Record<string, unknown>) =>
  Object.assign(new Error(message), props);

describe('errorHandler (production)', () => {
  it('answers an AppError thrown from sync and async handlers', async () => {
    const app = appThrowing(new AppError('conflict', 'Code taken', { field: 'code' }));
    for (const path of ['/sync', '/async']) {
      const res = await request(app).get(path);
      assert.equal(res.status, 409);
      assert.deepEqual(res.body, {
        error: 'Conflict',
        message: 'Code taken',
        details: { code: ['Code taken'] },
      });
    }
  });

  it('answers a RequestValidationError with 400 and field details', async () => {
    const app = express();
    app.get('/', () => parseOrThrow(z.object({ count: z.number() }), {}));
    app.use(errorHandler);

    const res = await request(app).get('/');
    assert.equal(res.status, 400);
    assert.deepEqual(Object.keys(res.body.details), ['count']);
  });

  it('checks AppError before a 4xx status, keeping its message', async () => {
    const err = Object.assign(new AppError('invalid', 'Plan not found'), {
      status: 418,
      type: 'entity.parse.failed',
    });
    const res = await request(appThrowing(err)).get('/sync');
    assert.equal(res.status, 400);
    assert.equal(res.body.message, 'Plan not found');
  });

  it('replaces a body-parser error message with a fixed one', async () => {
    const err = withProps('Unexpected token } in JSON at position 7', {
      status: 400,
      type: 'entity.parse.failed',
    });
    const res = await request(appThrowing(err)).get('/sync');
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: 'Bad Request', message: 'Malformed JSON body' });
  });

  it('answers other 4xx errors with their status and no message', async () => {
    const res = await request(appThrowing(withProps('raw', { status: 404 }))).get('/sync');
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: 'Not Found' });
  });

  it('treats a non-4xx status as a server fault', async () => {
    const res = await request(appThrowing(withProps('raw', { status: 503 }))).get('/sync');
    assert.equal(res.status, 500);
  });

  it('hides the message of an unexpected error and logs it', async () => {
    logs.reset();
    for (const err of [new Error('db password is hunter2'), 'a thrown string']) {
      const res = await request(appThrowing(err)).get('/async');
      assert.equal(res.status, 500);
      assert.deepEqual(res.body, { error: 'Internal Server Error' });
    }
    assert.equal(logs.error.mock.callCount(), 2);
  });

  it('hands the error to Express when the headers were already sent', () => {
    const err = new Error('late');
    const next = mock.fn<NextFunction>();
    const res = { headersSent: true } as Response;

    errorHandler(err, {} as Request, res, next);

    assert.equal(next.mock.callCount(), 1);
    assert.equal(next.mock.calls[0]?.arguments[0], err);
  });
});

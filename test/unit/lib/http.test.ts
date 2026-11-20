import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Response } from 'express';
import { z } from 'zod';
import { listPlansQuerySchema } from '../../../src/api/feature/plan/plan.schema.ts';
import {
  AppError,
  type AppErrorKind,
  RequestValidationError,
} from '../../../src/api/lib/errors.ts';
import {
  parseOrThrow,
  sendAppError,
  sendKnownError,
  sendValidationError,
} from '../../../src/api/lib/http.ts';

/** Records what a helper did to the response. */
const fakeResponse = () => {
  const res = {
    statusCode: undefined as number | undefined,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return { res, asExpress: res as unknown as Response };
};

const bodySchema = z.strictObject({ name: z.string(), age: z.number() });

const zodErrorFor = (value: unknown): z.ZodError => {
  const result = bodySchema.safeParse(value);
  assert.ok(!result.success);
  return result.error;
};

describe('parseOrThrow', () => {
  it('returns the parsed (and transformed) value', () => {
    assert.deepEqual(parseOrThrow(listPlansQuerySchema, { archived: 'true' }), { archived: true });
  });

  it('throws RequestValidationError holding the zod error', () => {
    assert.throws(
      () => parseOrThrow(bodySchema, { name: 1 }),
      (err: unknown) => {
        assert.ok(err instanceof RequestValidationError);
        assert.equal(err.message, 'Invalid request');
        assert.ok(err.zodError instanceof z.ZodError);
        return true;
      },
    );
  });
});

describe('sendValidationError', () => {
  it('puts field errors in details and whole-body errors in message', () => {
    const { res, asExpress } = fakeResponse();
    sendValidationError(asExpress, zodErrorFor({ name: 'Ada', age: 'x', extra: true }));

    assert.equal(res.statusCode, 400);
    const body = res.body as { error: string; message: string; details: Record<string, string[]> };
    assert.equal(body.error, 'Bad Request');
    assert.match(body.message, /Unrecognized key: "extra"/);
    assert.deepEqual(Object.keys(body.details), ['age']);
  });

  it('leaves message out when every error is on a field', () => {
    const { res, asExpress } = fakeResponse();
    sendValidationError(asExpress, zodErrorFor({ name: 1, age: 2 }));

    assert.ok(!Object.hasOwn(res.body as object, 'message'));
  });
});

describe('sendAppError', () => {
  const cases: {
    kind: AppErrorKind;
    field?: string;
    status: number;
    body: Record<string, unknown>;
  }[] = [
    { kind: 'invalid', status: 400, body: { error: 'Bad Request', message: 'm', details: {} } },
    {
      kind: 'invalid',
      field: 'planId',
      status: 400,
      body: { error: 'Bad Request', message: 'm', details: { planId: ['m'] } },
    },
    {
      kind: 'conflict',
      field: 'code',
      status: 409,
      body: { error: 'Conflict', message: 'm', details: { code: ['m'] } },
    },
    { kind: 'conflict', status: 409, body: { error: 'Conflict', message: 'm', details: {} } },
    // `not-found` never has details, even with a field.
    { kind: 'not-found', field: 'id', status: 404, body: { error: 'Not Found', message: 'm' } },
    // A field only adds details to a 400 or 409.
    {
      kind: 'rejected',
      field: 'items',
      status: 422,
      body: { error: 'Unprocessable Entity', message: 'm', details: {} },
    },
    { kind: 'upstream', status: 502, body: { error: 'Bad Gateway', message: 'm', details: {} } },
    {
      kind: 'unavailable',
      status: 503,
      body: { error: 'Service Unavailable', message: 'm', details: {} },
    },
  ];

  for (const { kind, field, status, body } of cases) {
    it(`answers ${kind}${field ? ` with field ${field}` : ''} with ${status}`, () => {
      const { res, asExpress } = fakeResponse();
      sendAppError(asExpress, new AppError(kind, 'm', field === undefined ? undefined : { field }));
      assert.equal(res.statusCode, status);
      assert.deepEqual(res.body, body);
    });
  }
});

describe('sendKnownError', () => {
  it('answers RequestValidationError and AppError', () => {
    const validation = fakeResponse();
    assert.equal(
      sendKnownError(validation.asExpress, new RequestValidationError(zodErrorFor({}))),
      true,
    );
    assert.equal(validation.res.statusCode, 400);

    const app = fakeResponse();
    assert.equal(sendKnownError(app.asExpress, new AppError('conflict', 'taken')), true);
    assert.equal(app.res.statusCode, 409);
  });

  it('leaves any other error alone', () => {
    const { res, asExpress } = fakeResponse();
    assert.equal(sendKnownError(asExpress, new Error('boom')), false);
    assert.equal(sendKnownError(asExpress, 'boom'), false);
    assert.equal(res.statusCode, undefined);
    assert.equal(res.body, undefined);
  });
});

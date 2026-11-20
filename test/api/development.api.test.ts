import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import express from 'express';
import request from 'supertest';
import { captureConsole } from '../helpers/console.ts';
import { loadApp } from '../helpers/env.ts';

// No `uiDir`: the default points at a directory that does not exist, as in `dev:api` alone.
const app = await loadApp({ nodeEnv: 'development' });
const { errorHandler } = await import('../../src/api/middleware/error-handler.ts');

captureConsole();

describe('app (development)', () => {
  it('leaves upgrade-insecure-requests out of the CSP', async () => {
    const res = await request(app).get('/api/health').expect(200);
    const csp = res.headers['content-security-policy'] ?? '';
    assert.match(csp, /default-src 'self'/);
    assert.doesNotMatch(csp, /upgrade-insecure-requests/);
  });

  it('answers a page request with a JSON 404 when the UI is not built', async () => {
    const res = await request(app).get('/clients').expect(404);
    assert.deepEqual(res.body, { error: 'Not Found', method: 'GET', path: '/clients' });
  });

  it('includes the message of an unexpected error', async () => {
    const bare = express();
    bare.get('/', () => {
      throw new Error('stack-worthy detail');
    });
    bare.use(errorHandler);

    const res = await request(bare).get('/').expect(500);
    assert.deepEqual(res.body, { error: 'Internal Server Error', message: 'stack-worthy detail' });
  });
});

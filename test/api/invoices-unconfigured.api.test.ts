import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { loadApp } from '../helpers/env.ts';
import { mockOncade } from '../helpers/oncade.ts';

const app = await loadApp({ oncade: false });

describe('/api/invoices (Oncade not configured)', () => {
  it('GET /config still works', async () => {
    const res = await request(app).get('/api/invoices/config').expect(200);
    assert.deepEqual(res.body, { data: { configured: false, environment: null } });
  });

  it('answers 503 on every other route, before validating anything', async (t) => {
    const { requests } = mockOncade(t);
    const calls = [
      request(app).get('/api/invoices'),
      request(app).get('/api/invoices?clientId=not-a-uuid'),
      request(app).get('/api/invoices/inv_1'),
      request(app).get('/api/invoices/bad.id'),
      request(app).post('/api/invoices').send({}),
      request(app).post('/api/invoices/inv_1/send'),
      request(app).post('/api/invoices/inv_1/cancel'),
    ];

    for (const call of calls) {
      const res = await call.expect(503);
      assert.deepEqual(res.body, {
        error: 'Service Unavailable',
        message: 'Oncade is not configured',
        details: {},
      });
    }
    assert.equal(requests.length, 0);
  });

  it('still answers 404 for unknown paths under /api/invoices', async () => {
    await request(app).get('/api/invoices/inv_1/history').expect(404);
    await request(app).delete('/api/invoices/inv_1').expect(404);
  });
});

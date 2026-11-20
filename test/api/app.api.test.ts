import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import request from 'supertest';
import { loadApp } from '../helpers/env.ts';

// A built UI in a temporary directory, so the SPA fallback has an index.html to serve.
const uiDir = mkdtempSync(path.join(os.tmpdir(), 'saas-admin-ui-'));
mkdirSync(path.join(uiDir, 'assets'));
writeFileSync(path.join(uiDir, 'index.html'), '<!doctype html><title>SPA shell</title>');
writeFileSync(path.join(uiDir, 'assets', 'app.js'), 'console.log("app");');

const app = await loadApp({ nodeEnv: 'production', uiDir });

describe('app (production)', () => {
  it('answers the health check', async () => {
    const res = await request(app).get('/api/health').expect(200);
    assert.equal(res.body.status, 'ok');
    assert.equal(typeof res.body.uptime, 'number');
    assert.ok(!Number.isNaN(Date.parse(res.body.timestamp)));
  });

  it('sets the security headers on API and SPA responses alike', async () => {
    for (const url of ['/api/health', '/clients', '/api/nope']) {
      const res = await request(app).get(url);
      const csp = res.headers['content-security-policy'] ?? '';
      assert.match(csp, /default-src 'self'/, url);
      assert.match(csp, /upgrade-insecure-requests/, url);
      assert.equal(res.headers['x-content-type-options'], 'nosniff', url);
      assert.ok(res.headers['strict-transport-security'], url);
      assert.equal(res.headers['x-powered-by'], undefined, url);
    }
  });

  describe('not found', () => {
    it('answers an unknown /api path with JSON, not the SPA', async () => {
      const res = await request(app)
        .get('/api/nope?x=1')
        .expect(404)
        .expect('Content-Type', /json/);
      assert.deepEqual(res.body, { error: 'Not Found', method: 'GET', path: '/api/nope?x=1' });
    });

    it('answers a non-GET request outside /api with JSON', async () => {
      const res = await request(app).post('/clients').expect(404);
      assert.deepEqual(res.body, { error: 'Not Found', method: 'POST', path: '/clients' });
    });
  });

  describe('request bodies', () => {
    it('answers malformed JSON with a fixed message', async () => {
      const res = await request(app)
        .post('/api/plans')
        .set('Content-Type', 'application/json')
        .send('{"code":')
        .expect(400);
      assert.deepEqual(res.body, { error: 'Bad Request', message: 'Malformed JSON body' });
    });

    it('answers a body over the size limit with 413', async () => {
      const res = await request(app)
        .post('/api/plans')
        .send({ description: 'x'.repeat(200_000) })
        .expect(413);
      assert.equal(res.body.message, 'Request body is too large');
    });
  });

  describe('SPA', () => {
    it('serves index.html for client-side routes', async () => {
      for (const url of ['/', '/clients', '/plans/new', '/invoices/inv_1']) {
        const res = await request(app).get(url).expect(200).expect('Content-Type', /html/);
        assert.match(res.text, /SPA shell/, url);
      }
    });

    it('answers HEAD for client-side routes', async () => {
      await request(app).head('/clients').expect(200).expect('Content-Type', /html/);
    });

    it('serves the built assets', async () => {
      const res = await request(app)
        .get('/assets/app.js')
        .expect(200)
        .expect('Content-Type', /javascript/);
      assert.equal(res.text, 'console.log("app");');
    });
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import { captureConsole } from '../helpers/console.ts';
import { loadApp } from '../helpers/env.ts';
import { CLIENT_IDS, UNKNOWN_ID } from '../helpers/fixtures.ts';
import { mockOncade, ONCADE, oncadeInvoice } from '../helpers/oncade.ts';

const app = await loadApp({ oncade: true });
captureConsole();

const IDEMPOTENCY_KEY = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

const createBody = (overrides: Record<string, unknown> = {}) => ({
  clientId: CLIENT_IDS.olivia,
  date: '2026-11-20',
  dueDate: '2026-12-04',
  items: [{ description: 'Pro plan, monthly', quantity: 1, unitPrice: 4900 }],
  ...overrides,
});

describe('/api/invoices (Oncade configured)', () => {
  it('GET /config reports the environment', async () => {
    const res = await request(app).get('/api/invoices/config').expect(200);
    assert.deepEqual(res.body, { data: { configured: true, environment: 'test' } });
  });

  describe('GET /', () => {
    it('lists invoices, filtered on clientId', async (t) => {
      const { requests } = mockOncade(t, {
        'GET /invoices': {
          json: {
            invoices: [
              oncadeInvoice({ _id: 'mine' }),
              oncadeInvoice({ _id: 'theirs', externalMetadata: { clientId: CLIENT_IDS.marcus } }),
            ],
          },
        },
      });

      const res = await request(app)
        .get(`/api/invoices?clientId=${CLIENT_IDS.olivia}&status=draft`)
        .expect(200);

      assert.equal(res.body.total, 1);
      assert.equal(res.body.data[0].id, 'mine');
      assert.equal(res.body.data[0].total, 4900);
      assert.equal(requests[0]?.url.searchParams.get('status'), 'draft');
    });

    for (const query of ['?clientId=olivia', '?status=overdue']) {
      it(`rejects ${query} without calling Oncade`, async (t) => {
        const { requests } = mockOncade(t);
        await request(app).get(`/api/invoices${query}`).expect(400);
        assert.equal(requests.length, 0);
      });
    }

    it('answers 502 when Oncade is down, without leaking the key', async (t) => {
      mockOncade(t, { 'GET /invoices': { status: 500, json: { message: 'internal' } } });

      const res = await request(app).get('/api/invoices').expect(502);
      assert.deepEqual(res.body, {
        error: 'Bad Gateway',
        message: 'Oncade is unavailable',
        details: {},
      });
      assert.ok(!res.text.includes(ONCADE.apiKey));
    });
  });

  describe('GET /:id', () => {
    it('returns an invoice', async (t) => {
      mockOncade(t, { 'GET /invoices/inv_test1': { json: oncadeInvoice() } });
      const res = await request(app).get('/api/invoices/inv_test1').expect(200);
      assert.equal(res.body.data.id, 'inv_test1');
    });

    it('rejects an id with characters that could change the Oncade URL', async (t) => {
      const { requests } = mockOncade(t);
      for (const id of ['inv.1', '..', 'a%2Fb', 'x'.repeat(65)]) {
        const res = await request(app).get(`/api/invoices/${id}`).expect(400);
        assert.deepEqual(res.body.details, { id: ['Invalid invoice id'] }, id);
      }
      assert.equal(requests.length, 0);
    });

    it('answers 404 when Oncade has no such invoice', async (t) => {
      mockOncade(t, { 'GET /invoices/inv_gone': { status: 404 } });
      const res = await request(app).get('/api/invoices/inv_gone').expect(404);
      assert.deepEqual(res.body, { error: 'Not Found', message: 'Invoice not found' });
    });
  });

  describe('POST /', () => {
    it('creates a draft for the client record, forwarding the idempotency key', async (t) => {
      const { requests } = mockOncade(t, {
        'POST /invoices': { status: 201, json: oncadeInvoice() },
      });

      const res = await request(app)
        .post('/api/invoices')
        .set('Idempotency-Key', IDEMPOTENCY_KEY)
        .send(createBody({ note: 'Thank you' }))
        .expect(201);

      assert.equal(res.headers['location'], '/api/invoices/inv_test1');
      assert.equal(res.body.data.status, 'draft');
      const [req] = requests;
      assert.equal(req?.headers.get('Idempotency-Key'), IDEMPOTENCY_KEY);
      const body = req?.body as Record<string, unknown>;
      assert.equal(body['receiverEmail'], 'olivia.bennett@northwind.io');
      assert.equal(body['note'], 'Thank you');
    });

    for (const [name, key] of [
      ['a missing', undefined],
      ['a non-UUID', 'retry-1'],
    ] as const) {
      it(`rejects ${name} Idempotency-Key`, async (t) => {
        const { requests } = mockOncade(t);
        const req = request(app).post('/api/invoices');
        if (key !== undefined) req.set('Idempotency-Key', key);

        const res = await req.send(createBody()).expect(400);
        assert.deepEqual(res.body.details, {
          'Idempotency-Key': ['Send an Idempotency-Key header holding a UUID'],
        });
        assert.equal(requests.length, 0);
      });
    }

    it('refuses a recipient in the body', async (t) => {
      const { requests } = mockOncade(t);
      const res = await request(app)
        .post('/api/invoices')
        .set('Idempotency-Key', IDEMPOTENCY_KEY)
        .send(createBody({ receiverEmail: 'attacker@example.com' }))
        .expect(400);
      assert.match(res.body.message, /Unrecognized key: "receiverEmail"/);
      assert.equal(requests.length, 0);
    });

    const invalid: [string, Record<string, unknown>, string][] = [
      ['a due date before the invoice date', { dueDate: '2026-11-19' }, 'dueDate'],
      ['no lines', { items: [] }, 'items'],
      ['a date that is not YYYY-MM-DD', { date: '20/11/2026' }, 'date'],
      [
        'a total over $10M',
        { items: [{ description: 'x', quantity: 10_000, unitPrice: 100_001 }] },
        'items',
      ],
    ];
    for (const [name, overrides, field] of invalid) {
      it(`rejects ${name}`, async (t) => {
        mockOncade(t);
        const res = await request(app)
          .post('/api/invoices')
          .set('Idempotency-Key', IDEMPOTENCY_KEY)
          .send(createBody(overrides))
          .expect(400);
        assert.ok(field in res.body.details, JSON.stringify(res.body));
      });
    }

    it('answers 400 on clientId for an unknown client', async (t) => {
      mockOncade(t);
      const res = await request(app)
        .post('/api/invoices')
        .set('Idempotency-Key', IDEMPOTENCY_KEY)
        .send(createBody({ clientId: UNKNOWN_ID }))
        .expect(400);
      assert.deepEqual(res.body.details, { clientId: ['Client not found'] });
    });

    it('answers 422 with Oncade’s message when Oncade rejects the invoice', async (t) => {
      mockOncade(t, { 'POST /invoices': { status: 400, json: { message: 'Total mismatch' } } });
      const res = await request(app)
        .post('/api/invoices')
        .set('Idempotency-Key', IDEMPOTENCY_KEY)
        .send(createBody())
        .expect(422);
      assert.deepEqual(res.body, {
        error: 'Unprocessable Entity',
        message: 'Total mismatch',
        details: {},
      });
    });
  });

  for (const [action, status] of [
    ['send', 'sent'],
    ['cancel', 'cancelled'],
  ] as const) {
    describe(`POST /:id/${action}`, () => {
      it('answers with the re-fetched invoice', async (t) => {
        const { requests } = mockOncade(t, {
          [`POST /invoices/inv_test1/${action}`]: { json: {} },
          'GET /invoices/inv_test1': { json: oncadeInvoice({ status }) },
        });

        const res = await request(app)
          .post(`/api/invoices/inv_test1/${action}`)
          .set('Idempotency-Key', IDEMPOTENCY_KEY)
          .expect(200);

        assert.equal(res.body.data.status, status);
        assert.equal(requests[0]?.headers.get('Idempotency-Key'), IDEMPOTENCY_KEY);
      });

      it('still answers 200 when the re-fetch fails', async (t) => {
        mockOncade(t, {
          [`POST /invoices/inv_test1/${action}`]: { json: {} },
          'GET /invoices/inv_test1': new TypeError('fetch failed'),
        });

        const res = await request(app)
          .post(`/api/invoices/inv_test1/${action}`)
          .set('Idempotency-Key', IDEMPOTENCY_KEY)
          .expect(200);

        assert.deepEqual(res.body, {
          data: null,
          message: 'Done, but the updated invoice could not be loaded',
        });
      });

      it('answers 422 for a transition Oncade refuses', async (t) => {
        mockOncade(t, {
          [`POST /invoices/inv_test1/${action}`]: {
            status: 409,
            json: { error: 'Invoice is already paid' },
          },
        });

        const res = await request(app)
          .post(`/api/invoices/inv_test1/${action}`)
          .set('Idempotency-Key', IDEMPOTENCY_KEY)
          .expect(422);
        assert.equal(res.body.message, 'Invoice is already paid');
      });

      it('answers 502 when Oncade rejects our key', async (t) => {
        mockOncade(t, { [`POST /invoices/inv_test1/${action}`]: { status: 401 } });
        await request(app)
          .post(`/api/invoices/inv_test1/${action}`)
          .set('Idempotency-Key', IDEMPOTENCY_KEY)
          .expect(502);
      });

      it('requires an Idempotency-Key', async (t) => {
        const { requests } = mockOncade(t);
        await request(app).post(`/api/invoices/inv_test1/${action}`).expect(400);
        assert.equal(requests.length, 0);
      });

      it('validates the id before the key', async (t) => {
        mockOncade(t);
        const res = await request(app).post(`/api/invoices/inv.1/${action}`).expect(400);
        assert.deepEqual(Object.keys(res.body.details), ['id']);
      });
    });
  }
});

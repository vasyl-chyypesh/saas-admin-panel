import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import * as oncadeClient from '../../../../src/api/feature/invoice/invoice.oncade.ts';
import type { CreateInvoiceInput } from '../../../../src/api/feature/invoice/invoice.schema.ts';
import { captureConsole } from '../../../helpers/console.ts';
import { CLIENT_IDS, OLIVIA, PLAN_IDS } from '../../../helpers/fixtures.ts';
import { mockOncade, ONCADE, oncadeInvoice } from '../../../helpers/oncade.ts';

const logs = captureConsole();
beforeEach(() => logs.reset());

const IDEMPOTENCY_KEY = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

/** Every log line, checked for the API key: it may appear only in the Authorization header. */
const assertKeyNeverLogged = () => {
  for (const line of logs.lines()) {
    assert.ok(!line.includes(ONCADE.apiKey), `a log line quotes the API key: ${line}`);
  }
};

const expectOncadeError =
  (kind: oncadeClient.OncadeErrorKind, status: number, message?: string) => (err: unknown) => {
    assert.ok(err instanceof oncadeClient.OncadeError);
    assert.equal(err.kind, kind);
    assert.equal(err.status, status);
    if (message !== undefined) assert.equal(err.message, message);
    return true;
  };

/** An Oncade list page of `count` invoices with distinct ids. */
const page = (pageNumber: number, count: number, totalPages?: number) => ({
  invoices: Array.from({ length: count }, (_, i) =>
    oncadeInvoice({ _id: `inv_${pageNumber}_${i}` }),
  ),
  ...(totalPages !== undefined && { pagination: { totalPages } }),
});

/** Answers `GET /invoices` with `pages[n - 1]` for `?page=n`. */
const pagedRoute = (pages: unknown[]) => ({
  'GET /invoices': ({ url }: { url: URL }) => ({
    json: pages[Number(url.searchParams.get('page')) - 1],
  }),
});

describe('invoice.oncade', () => {
  describe('request', () => {
    it('sends our key, business id and API version, and refuses redirects', async (t) => {
      const { requests } = mockOncade(t, { 'GET /invoices/inv_test1': { json: oncadeInvoice() } });

      await oncadeClient.getInvoice(ONCADE, 'inv_test1');

      assert.equal(requests.length, 1);
      const [req] = requests;
      assert.ok(req);
      assert.equal(req.url.href, 'https://oncade.test/api/v1/platform/invoices/inv_test1');
      assert.equal(req.headers.get('Authorization'), `Bearer ${ONCADE.apiKey}`);
      assert.equal(req.headers.get('X-Target-Business-Id'), ONCADE.businessId);
      assert.equal(req.headers.get('X-Oncade-API-Version'), 'v1');
      assert.equal(req.headers.get('Accept'), 'application/json');
      assert.equal(req.headers.get('Idempotency-Key'), null);
      assert.equal(req.headers.get('Content-Type'), null);
      assert.equal(req.init.redirect, 'error');
      assert.ok(req.init.signal instanceof AbortSignal);
      assert.equal(req.init.body, undefined);
    });

    it('encodes the invoice id into the path', async (t) => {
      const { requests } = mockOncade(t, {
        'GET /invoices/a%2Fb%3Fc': { json: oncadeInvoice() },
      });
      await oncadeClient.getInvoice(ONCADE, 'a/b?c');
      assert.equal(requests[0]?.url.search, '');
    });
  });

  describe('response mapping', () => {
    it('converts an Oncade invoice to ours, dollars to cents', async (t) => {
      mockOncade(t, { 'GET /invoices/inv_test1': { json: oncadeInvoice({ note: 'Thanks' }) } });

      assert.deepEqual(await oncadeClient.getInvoice(ONCADE, 'inv_test1'), {
        id: 'inv_test1',
        number: 'INV-0001',
        status: 'draft',
        clientId: CLIENT_IDS.olivia,
        receiverName: 'Northwind Analytics',
        receiverEmail: 'olivia.bennett@northwind.io',
        date: '2026-11-20',
        dueDate: '2026-12-04',
        items: [{ description: 'Pro plan, monthly', quantity: 1, unitPrice: 4900, amount: 4900 }],
        tax: 0,
        total: 4900,
        note: 'Thanks',
        paymentSummary: { invoiceAmount: 4900, payerFee: 172, totalCharged: 5072 },
        payUrl: 'https://www.oncade.gg/pay/inv_test1',
        environment: 'test',
        createdAt: '2026-11-20T10:00:00.000Z',
      });
    });

    it('accepts an invoice with only _id and status', async (t) => {
      mockOncade(t, { 'GET /invoices/inv_2': { json: { _id: 'inv_2', status: 'paid' } } });

      assert.deepEqual(await oncadeClient.getInvoice(ONCADE, 'inv_2'), {
        id: 'inv_2',
        number: null,
        status: 'paid',
        clientId: null,
        receiverName: null,
        receiverEmail: null,
        date: null,
        dueDate: null,
        items: [],
        tax: null,
        total: null,
        note: null,
        paymentSummary: null,
        payUrl: null,
        environment: null,
        createdAt: null,
      });
    });

    it('fills missing item fields and rounds float noise', async (t) => {
      mockOncade(t, {
        'GET /invoices/inv_test1': {
          json: oncadeInvoice({
            items: [
              {},
              { description: 'Seats', quantity: 3, rate: 19.99 },
              { rate: 0.29, amount: 0.29 },
            ],
          }),
        },
      });

      const { items } = await oncadeClient.getInvoice(ONCADE, 'inv_test1');
      assert.deepEqual(items, [
        { description: '', quantity: 1, unitPrice: 0, amount: 0 },
        { description: 'Seats', quantity: 3, unitPrice: 1999, amount: 5997 },
        { description: '', quantity: 1, unitPrice: 29, amount: 29 },
      ]);
    });

    for (const link of ['javascript:alert(1)', 'http://www.oncade.gg/pay/x', 'not a url']) {
      it(`drops a payUrl that is not https: ${link}`, async (t) => {
        mockOncade(t, {
          'GET /invoices/inv_test1': { json: oncadeInvoice({ links: { invoice: link } }) },
        });
        assert.equal((await oncadeClient.getInvoice(ONCADE, 'inv_test1')).payUrl, null);
      });
    }

    it('drops dates it cannot read and a clientId that is not a string', async (t) => {
      mockOncade(t, {
        'GET /invoices/inv_test1': {
          json: oncadeInvoice({ date: 'yesterday', externalMetadata: { clientId: 42 } }),
        },
      });
      const invoice = await oncadeClient.getInvoice(ONCADE, 'inv_test1');
      assert.equal(invoice.date, null);
      assert.equal(invoice.clientId, null);
    });

    for (const [name, reply] of [
      ['a missing _id', { json: { status: 'draft', receiverEmail: 'pii@example.com' } }],
      ['an unknown status', { json: oncadeInvoice({ status: 'refunded' }) }],
      ['a body that is not JSON', { text: '<html>maintenance</html>' }],
      ['an empty body', {}],
    ] as const) {
      it(`fails with bad-response on ${name}, without logging the body`, async (t) => {
        mockOncade(t, { 'GET /invoices/inv_test1': reply });

        await assert.rejects(
          oncadeClient.getInvoice(ONCADE, 'inv_test1'),
          expectOncadeError('bad-response', 200, 'Oncade returned an unexpected response'),
        );
        assert.ok(logs.lines().every((line) => !line.includes('pii@example.com')));
      });
    }
  });

  describe('errors', () => {
    const cases: {
      status: number;
      body?: unknown;
      kind: oncadeClient.OncadeErrorKind;
      message: string;
      logged: boolean;
    }[] = [
      {
        status: 500,
        body: { message: 'db down' },
        kind: 'unavailable',
        message: 'Oncade is unavailable',
        logged: true,
      },
      { status: 503, kind: 'unavailable', message: 'Oncade is unavailable', logged: true },
      {
        status: 401,
        body: { message: 'bad key' },
        kind: 'auth',
        message: 'Oncade rejected our API key',
        logged: true,
      },
      {
        status: 403,
        body: { message: 'No grant for business' },
        kind: 'forbidden',
        message: 'No grant for business',
        logged: true,
      },
      { status: 403, kind: 'forbidden', message: 'Oncade refused access', logged: true },
      { status: 404, kind: 'not-found', message: 'Not found in Oncade', logged: false },
      {
        status: 404,
        body: { error: 'Invoice missing' },
        kind: 'not-found',
        message: 'Invoice missing',
        logged: false,
      },
      {
        status: 422,
        body: { error: 'Total mismatch' },
        kind: 'rejected',
        message: 'Total mismatch',
        logged: false,
      },
      {
        status: 400,
        body: { message: 7, error: 'Bad dueDate' },
        kind: 'rejected',
        message: 'Bad dueDate',
        logged: false,
      },
      {
        status: 409,
        kind: 'rejected',
        message: 'Oncade rejected the request (409)',
        logged: false,
      },
    ];

    for (const { status, body, kind, message, logged } of cases) {
      it(`maps ${status} ${body === undefined ? 'without a body' : JSON.stringify(body)} to ${kind}`, async (t) => {
        mockOncade(t, { 'GET /invoices/inv_test1': { status, json: body } });

        await assert.rejects(
          oncadeClient.getInvoice(ONCADE, 'inv_test1'),
          expectOncadeError(kind, status, message),
        );
        assert.equal(logs.error.mock.callCount(), logged ? 1 : 0);
        assertKeyNeverLogged();
      });
    }

    it('cuts a long Oncade message to 300 characters', async (t) => {
      mockOncade(t, {
        'GET /invoices/inv_test1': { status: 400, json: { message: 'x'.repeat(500) } },
      });
      await assert.rejects(oncadeClient.getInvoice(ONCADE, 'inv_test1'), (err: Error) => {
        assert.equal(err.message.length, 300);
        return true;
      });
    });

    it('uses the default message when the error body is not JSON', async (t) => {
      mockOncade(t, { 'GET /invoices/inv_test1': { status: 400, text: 'Bad Request' } });
      await assert.rejects(
        oncadeClient.getInvoice(ONCADE, 'inv_test1'),
        expectOncadeError('rejected', 400, 'Oncade rejected the request (400)'),
      );
    });

    it('turns a network failure into unavailable, logging only the error class and code', async (t) => {
      const cause = Object.assign(new Error(`connect failed, header Bearer ${ONCADE.apiKey}`), {
        code: 'ECONNREFUSED',
      });
      mockOncade(t, { 'GET /invoices/inv_test1': new TypeError('fetch failed', { cause }) });

      await assert.rejects(
        oncadeClient.getInvoice(ONCADE, 'inv_test1'),
        expectOncadeError('unavailable', 0, 'Oncade is unavailable'),
      );
      assert.deepEqual(logs.lines(), [
        '[oncade] GET /invoices/inv_test1 failed: TypeError (ECONNREFUSED)',
      ]);
      assertKeyNeverLogged();
    });

    it('turns a timeout into unavailable', async (t) => {
      mockOncade(t, {
        'GET /invoices/inv_test1': new DOMException('The operation timed out.', 'TimeoutError'),
      });

      await assert.rejects(
        oncadeClient.getInvoice(ONCADE, 'inv_test1'),
        expectOncadeError('unavailable', 0),
      );
      assert.deepEqual(logs.lines(), ['[oncade] GET /invoices/inv_test1 failed: TimeoutError']);
    });

    it('turns a body that fails mid-read into unavailable', async (t) => {
      const body = new ReadableStream({
        start(controller) {
          controller.error(new Error('socket reset'));
        },
      });
      mockOncade(t, { 'GET /invoices/inv_test1': new Response(body) });

      await assert.rejects(
        oncadeClient.getInvoice(ONCADE, 'inv_test1'),
        expectOncadeError('unavailable', 0),
      );
    });
  });

  describe('createInvoice', () => {
    const input: CreateInvoiceInput = {
      clientId: CLIENT_IDS.olivia,
      date: '2026-11-20',
      dueDate: '2026-12-04',
      items: [
        { description: 'Pro plan', quantity: 2, unitPrice: 1999 },
        { description: 'Setup', quantity: 1, unitPrice: 5 },
      ],
      tax: 333,
      note: 'Thanks!',
    };

    it('posts a draft in dollars, addressed to the client record', async (t) => {
      const { requests } = mockOncade(t, {
        'POST /invoices': { status: 201, json: oncadeInvoice() },
      });

      const invoice = await oncadeClient.createInvoice(ONCADE, OLIVIA, input, IDEMPOTENCY_KEY);

      assert.equal(invoice.id, 'inv_test1');
      const [req] = requests;
      assert.ok(req);
      assert.equal(req.headers.get('Idempotency-Key'), IDEMPOTENCY_KEY);
      assert.equal(req.headers.get('Content-Type'), 'application/json');
      assert.deepEqual(req.body, {
        receiverName: 'Northwind Analytics',
        receiverEmail: 'olivia.bennett@northwind.io',
        date: '2026-11-20',
        dueDate: '2026-12-04',
        payToTarget: 'BUSINESS',
        items: [
          { description: 'Pro plan', quantity: 2, rate: 19.99, amount: 39.98 },
          { description: 'Setup', quantity: 1, rate: 0.05, amount: 0.05 },
        ],
        tax: 3.33,
        total: 43.36,
        note: 'Thanks!',
        externalMetadata: {
          source: 'saas-admin-panel',
          clientId: CLIENT_IDS.olivia,
          planId: PLAN_IDS.pro,
        },
      });
    });

    it('leaves out tax and an empty note', async (t) => {
      const { requests } = mockOncade(t, {
        'POST /invoices': { status: 201, json: oncadeInvoice() },
      });

      const { tax: _tax, ...withoutTax } = input;
      await oncadeClient.createInvoice(
        ONCADE,
        OLIVIA,
        { ...withoutTax, note: '' },
        IDEMPOTENCY_KEY,
      );

      const body = requests[0]?.body as Record<string, unknown>;
      assert.ok(!('tax' in body));
      assert.ok(!('note' in body));
      assert.ok(!('status' in body));
      assert.equal(body['total'], 40.03);
    });
  });

  describe('sendInvoice / cancelInvoice', () => {
    it('posts send with an empty body and the idempotency key', async (t) => {
      const { requests } = mockOncade(t, {
        'POST /invoices/inv_test1/send': { json: { _id: 'inv_test1', status: 'sent' } },
      });

      assert.equal(await oncadeClient.sendInvoice(ONCADE, 'inv_test1', IDEMPOTENCY_KEY), undefined);
      assert.deepEqual(requests[0]?.body, {});
      assert.equal(requests[0]?.headers.get('Idempotency-Key'), IDEMPOTENCY_KEY);
    });

    it('posts cancel without a body', async (t) => {
      const { requests } = mockOncade(t, { 'POST /invoices/inv_test1/cancel': { json: {} } });

      assert.equal(
        await oncadeClient.cancelInvoice(ONCADE, 'inv_test1', IDEMPOTENCY_KEY),
        undefined,
      );
      assert.equal(requests[0]?.init.body, undefined);
      assert.equal(requests[0]?.headers.get('Content-Type'), null);
      assert.equal(requests[0]?.headers.get('Idempotency-Key'), IDEMPOTENCY_KEY);
    });

    it('fails with Oncade’s message on an invalid transition', async (t) => {
      mockOncade(t, {
        'POST /invoices/inv_test1/send': {
          status: 422,
          json: { message: 'Invoice is not a draft' },
        },
      });
      await assert.rejects(
        oncadeClient.sendInvoice(ONCADE, 'inv_test1', IDEMPOTENCY_KEY),
        expectOncadeError('rejected', 422, 'Invoice is not a draft'),
      );
    });
  });

  describe('listInvoices', () => {
    it('asks for the first page of 100, with the status filter when given', async (t) => {
      const { requests } = mockOncade(t, pagedRoute([page(1, 2, 1)]));

      assert.equal((await oncadeClient.listInvoices(ONCADE)).length, 2);
      await oncadeClient.listInvoices(ONCADE, { status: 'sent' });

      assert.equal(requests[0]?.url.search, '?page=1&limit=100');
      assert.equal(requests[1]?.url.search, '?page=1&limit=100&status=sent');
    });

    it('follows pages until totalPages', async (t) => {
      const { requests } = mockOncade(
        t,
        pagedRoute([page(1, 100, 3), page(2, 100, 3), page(3, 5, 3)]),
      );

      const invoices = await oncadeClient.listInvoices(ONCADE);

      assert.equal(invoices.length, 205);
      assert.equal(requests.length, 3);
      assert.equal(invoices.at(-1)?.id, 'inv_3_4');
    });

    it('stops at a short page even if totalPages says there are more', async (t) => {
      const { requests } = mockOncade(t, pagedRoute([page(1, 50, 5)]));
      assert.equal((await oncadeClient.listInvoices(ONCADE)).length, 50);
      assert.equal(requests.length, 1);
    });

    it('stops after one page when there is no pagination object', async (t) => {
      const { requests } = mockOncade(t, pagedRoute([page(1, 100)]));
      assert.equal((await oncadeClient.listInvoices(ONCADE)).length, 100);
      assert.equal(requests.length, 1);
    });

    it('stops at 10 pages and warns that the list is truncated', async (t) => {
      const pages = Array.from({ length: 20 }, (_, i) => page(i + 1, 100, 20));
      const { requests } = mockOncade(t, pagedRoute(pages));

      assert.equal((await oncadeClient.listInvoices(ONCADE)).length, 1000);
      assert.equal(requests.length, 10);
      assert.equal(logs.warn.mock.callCount(), 1);
      assert.match(String(logs.warn.mock.calls[0]?.arguments[0]), /truncated at 10 pages/);
    });

    it('skips and logs an entry it cannot parse', async (t) => {
      mockOncade(t, {
        'GET /invoices': { json: { invoices: [oncadeInvoice(), { status: 'draft' }] } },
      });

      const invoices = await oncadeClient.listInvoices(ONCADE);
      assert.deepEqual(
        invoices.map((invoice) => invoice.id),
        ['inv_test1'],
      );
      assert.equal(logs.error.mock.callCount(), 1);
    });

    it('fails with bad-response when the list itself has the wrong shape', async (t) => {
      mockOncade(t, { 'GET /invoices': { json: { data: [] } } });
      await assert.rejects(
        oncadeClient.listInvoices(ONCADE),
        expectOncadeError('bad-response', 200),
      );
    });
  });
});

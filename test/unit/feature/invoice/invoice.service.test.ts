import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { captureConsole } from '../../../helpers/console.ts';
import { setTestEnv } from '../../../helpers/env.ts';
import { CLIENT_IDS, UNKNOWN_ID } from '../../../helpers/fixtures.ts';
import { mockOncade, oncadeInvoice } from '../../../helpers/oncade.ts';

// `invoice.service.ts` reads `config.oncade`, so the environment is set before it is imported.
setTestEnv({ oncade: true });
const invoiceService = await import('../../../../src/api/feature/invoice/invoice.service.ts');
const { AppError } = await import('../../../../src/api/lib/errors.ts');
const { OncadeError } = await import('../../../../src/api/feature/invoice/invoice.oncade.ts');

const logs = captureConsole();
beforeEach(() => logs.reset());

const IDEMPOTENCY_KEY = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

const expectAppError = (kind: string, message?: string) => (err: unknown) => {
  assert.ok(err instanceof AppError, `expected an AppError, got ${String(err)}`);
  assert.equal(err.kind, kind);
  if (message !== undefined) assert.equal(err.message, message);
  return true;
};

describe('invoice.service', () => {
  it('reports the Oncade config', () => {
    assert.equal(invoiceService.isConfigured(), true);
    assert.deepEqual(invoiceService.getConfig(), { configured: true, environment: 'test' });
  });

  describe('Oncade failures', () => {
    const cases = [
      { status: 404, kind: 'not-found', message: 'Invoice not found' },
      { status: 422, json: { message: 'Not a draft' }, kind: 'rejected', message: 'Not a draft' },
      { status: 401, kind: 'upstream', message: 'Oncade rejected our API key' },
      { status: 403, kind: 'upstream', message: 'Oncade refused access' },
      { status: 500, kind: 'upstream', message: 'Oncade is unavailable' },
      {
        status: 200,
        json: { nope: true },
        kind: 'upstream',
        message: 'Oncade returned an unexpected response',
      },
    ];

    for (const { status, json, kind, message } of cases) {
      it(`turns Oncade's ${status}${json ? ` ${JSON.stringify(json)}` : ''} into ${kind}`, async (t) => {
        mockOncade(t, { 'GET /invoices/inv_1': { status, json } });

        await assert.rejects(invoiceService.getInvoice('inv_1'), (err: unknown) => {
          expectAppError(kind, message)(err);
          assert.ok((err as Error).cause instanceof OncadeError);
          return true;
        });
      });
    }
  });

  describe('listInvoices', () => {
    const invoices = [
      oncadeInvoice({
        _id: 'a',
        externalMetadata: { clientId: CLIENT_IDS.olivia },
        createdAt: '2026-11-01T00:00:00Z',
      }),
      oncadeInvoice({
        _id: 'b',
        externalMetadata: { clientId: CLIENT_IDS.marcus },
        createdAt: '2026-11-10T00:00:00Z',
      }),
      // No createdAt: sorted by its date instead.
      oncadeInvoice({ _id: 'c', externalMetadata: null, createdAt: null, date: '2026-11-05' }),
      // Neither: sorted last.
      oncadeInvoice({ _id: 'd', createdAt: null, date: null }),
    ];

    it('sorts newest first, falling back to the invoice date', async (t) => {
      mockOncade(t, { 'GET /invoices': { json: { invoices } } });
      const list = await invoiceService.listInvoices({});
      assert.deepEqual(
        list.map((invoice) => invoice.id),
        ['b', 'c', 'a', 'd'],
      );
    });

    it('filters on clientId here and passes status to Oncade', async (t) => {
      const { requests } = mockOncade(t, { 'GET /invoices': { json: { invoices } } });

      const list = await invoiceService.listInvoices({
        status: 'draft',
        clientId: CLIENT_IDS.olivia,
      });

      // `d` gets Olivia's clientId from the fixture's default metadata.
      assert.deepEqual(
        list.map((invoice) => invoice.id),
        ['a', 'd'],
      );
      assert.equal(requests[0]?.url.searchParams.get('status'), 'draft');
    });
  });

  describe('createInvoice', () => {
    const input = {
      clientId: CLIENT_IDS.olivia,
      date: '2026-11-20',
      dueDate: '2026-12-04',
      items: [{ description: 'Pro plan', quantity: 1, unitPrice: 4900 }],
    };

    it('addresses the invoice to the client record', async (t) => {
      const { requests } = mockOncade(t, {
        'POST /invoices': { status: 201, json: oncadeInvoice() },
      });

      const invoice = await invoiceService.createInvoice(input, IDEMPOTENCY_KEY);

      assert.equal(invoice.id, 'inv_test1');
      const body = requests[0]?.body as Record<string, unknown>;
      assert.equal(body['receiverEmail'], 'olivia.bennett@northwind.io');
      assert.equal(body['receiverName'], 'Northwind Analytics');
    });

    it('rejects an unknown client without calling Oncade', async (t) => {
      const { requests } = mockOncade(t);

      await assert.rejects(
        invoiceService.createInvoice({ ...input, clientId: UNKNOWN_ID }, IDEMPOTENCY_KEY),
        (err: unknown) => {
          expectAppError('invalid', 'Client not found')(err);
          assert.equal((err as InstanceType<typeof AppError>).field, 'clientId');
          return true;
        },
      );
      assert.equal(requests.length, 0);
    });
  });

  for (const action of ['send', 'cancel'] as const) {
    const run = action === 'send' ? invoiceService.sendInvoice : invoiceService.cancelInvoice;
    const status = action === 'send' ? 'sent' : 'cancelled';

    describe(`${action}Invoice`, () => {
      it('posts the transition, then returns the re-fetched invoice', async (t) => {
        const { requests } = mockOncade(t, {
          [`POST /invoices/inv_test1/${action}`]: { json: { _id: 'inv_test1', status } },
          'GET /invoices/inv_test1': { json: oncadeInvoice({ status }) },
        });

        const invoice = await run('inv_test1', IDEMPOTENCY_KEY);

        assert.equal(invoice?.status, status);
        assert.deepEqual(
          requests.map((req) => `${req.method} ${req.path}`),
          [`POST /invoices/inv_test1/${action}`, 'GET /invoices/inv_test1'],
        );
      });

      it('still succeeds, with null, when the re-fetch fails', async (t) => {
        mockOncade(t, {
          [`POST /invoices/inv_test1/${action}`]: { json: {} },
          'GET /invoices/inv_test1': { status: 502 },
        });

        assert.equal(await run('inv_test1', IDEMPOTENCY_KEY), null);
        assert.ok(
          logs
            .lines()
            .includes('[oncade] invoice inv_test1 changed, but re-fetching it failed: unavailable'),
        );
      });

      it('fails, without re-fetching, when Oncade refuses the transition', async (t) => {
        const { requests } = mockOncade(t, {
          [`POST /invoices/inv_test1/${action}`]: {
            status: 422,
            json: { message: 'Already paid' },
          },
        });

        await assert.rejects(
          run('inv_test1', IDEMPOTENCY_KEY),
          expectAppError('rejected', 'Already paid'),
        );
        assert.equal(requests.length, 1);
      });
    });
  }
});

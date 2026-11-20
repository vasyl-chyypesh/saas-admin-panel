import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setTestEnv } from '../../../helpers/env.ts';
import { CLIENT_IDS } from '../../../helpers/fixtures.ts';
import { mockOncade } from '../../../helpers/oncade.ts';

setTestEnv({ oncade: false });
const invoiceService = await import('../../../../src/api/feature/invoice/invoice.service.ts');

const IDEMPOTENCY_KEY = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const unavailable = { kind: 'unavailable', message: 'Oncade is not configured' };

describe('invoice.service without Oncade', () => {
  it('reports that Oncade is not configured', () => {
    assert.equal(invoiceService.isConfigured(), false);
    assert.deepEqual(invoiceService.getConfig(), { configured: false, environment: null });
  });

  it('fails every operation with unavailable, without calling out', async (t) => {
    const { requests } = mockOncade(t);
    const input = {
      clientId: CLIENT_IDS.olivia,
      date: '2026-11-20',
      dueDate: '2026-11-20',
      items: [{ description: 'x', quantity: 1, unitPrice: 1 }],
    };

    await assert.rejects(invoiceService.listInvoices({}), unavailable);
    await assert.rejects(invoiceService.getInvoice('inv_1'), unavailable);
    await assert.rejects(invoiceService.createInvoice(input, IDEMPOTENCY_KEY), unavailable);
    await assert.rejects(invoiceService.sendInvoice('inv_1', IDEMPOTENCY_KEY), unavailable);
    await assert.rejects(invoiceService.cancelInvoice('inv_1', IDEMPOTENCY_KEY), unavailable);
    assert.equal(requests.length, 0);
  });
});

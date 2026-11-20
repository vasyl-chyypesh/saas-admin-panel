import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { OncadeConfig } from '../../src/api/config.ts';
import { CLIENT_IDS, PLAN_IDS } from './fixtures.ts';

/** The Oncade config every test uses. `env.ts` sets the matching environment variables. */
export const ONCADE: OncadeConfig = {
  apiKey: 'oncade_platform_test_SECRET-key-for-tests',
  businessId: 'biz_test_123',
  apiUrl: 'https://oncade.test',
  environment: 'test',
};

const BASE_PATH = '/api/v1/platform';

export interface OncadeRequest {
  method: string;
  url: URL;
  /** Path below `/api/v1/platform`, without the query string. */
  path: string;
  headers: Headers;
  /** The parsed JSON body, or `undefined` when none was sent. */
  body: unknown;
  init: RequestInit;
}

/** `json` and `text` are the response body; a `Response` or an `Error` (a network failure) as is. */
export type OncadeReply = { status?: number; json?: unknown; text?: string } | Response | Error;

export type OncadeRoute = OncadeReply | ((req: OncadeRequest) => OncadeReply);

const toResponse = (reply: OncadeReply): Response => {
  if (reply instanceof Response) return reply;
  if (reply instanceof Error) throw reply;
  const status = reply.status ?? 200;
  if (reply.text !== undefined) return new Response(reply.text, { status });
  if (reply.json !== undefined) return Response.json(reply.json, { status });
  return new Response(null, { status });
};

/**
 * Replaces `fetch` for one test (restored when it ends). Routes are keyed `"<METHOD> <path>"`,
 * the path below `/api/v1/platform` without the query string, e.g. `"GET /invoices/inv_1"`.
 *
 * A request to any other URL fails the test, so a test can never reach the network. The failure
 * is reported when the test ends, because `invoice.oncade.ts` catches whatever `fetch` throws.
 */
export const mockOncade = (t: TestContext, routes: Record<string, OncadeRoute> = {}) => {
  const requests: OncadeRequest[] = [];
  const unexpected: string[] = [];

  const fetchMock = t.mock.method(
    globalThis,
    'fetch',
    async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
      const url = new URL(input instanceof Request ? input.url : input);
      const method = init.method ?? 'GET';
      const path = url.pathname.startsWith(BASE_PATH)
        ? url.pathname.slice(BASE_PATH.length)
        : url.pathname;
      const req: OncadeRequest = {
        method,
        url,
        path,
        headers: new Headers(init.headers),
        body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
        init,
      };
      requests.push(req);

      const key = `${method} ${path}`;
      const route = url.origin === ONCADE.apiUrl ? routes[key] : undefined;
      if (route === undefined) {
        unexpected.push(`${method} ${url.href}`);
        throw new Error(`Unexpected request: ${method} ${url.href}`);
      }
      return toResponse(typeof route === 'function' ? route(req) : route);
    },
  );

  t.after(() => {
    assert.deepEqual(unexpected, [], 'fetch was called with an unexpected request');
  });

  return { fetch: fetchMock, requests };
};

/** An Oncade invoice as Oncade's API returns it (money in dollars). */
export const oncadeInvoice = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  _id: 'inv_test1',
  status: 'draft',
  invoiceNumber: 'INV-0001',
  receiverName: 'Northwind Analytics',
  receiverEmail: 'olivia.bennett@northwind.io',
  date: '2026-11-20T00:00:00.000Z',
  dueDate: '2026-12-04',
  items: [{ description: 'Pro plan, monthly', quantity: 1, rate: 49, amount: 49 }],
  tax: 0,
  total: 49,
  note: null,
  externalMetadata: {
    source: 'saas-admin-panel',
    clientId: CLIENT_IDS.olivia,
    planId: PLAN_IDS.pro,
  },
  paymentSummary: { invoiceAmount: 49, payerFee: 1.72, totalCharged: 50.72 },
  links: { invoice: 'https://www.oncade.gg/pay/inv_test1' },
  environment: 'test',
  createdAt: '2026-11-20T10:00:00.000Z',
  ...overrides,
});

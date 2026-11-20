import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import type { Client } from '../../src/api/feature/client/client.schema.ts';
import { loadApp } from '../helpers/env.ts';
import { CLIENT_IDS, CLIENTS_NEWEST_FIRST, PLAN_IDS, UNKNOWN_ID } from '../helpers/fixtures.ts';

const app = await loadApp();

const listIds = async (query: string): Promise<string[]> => {
  const res = await request(app).get(`/api/clients${query}`).expect(200);
  assert.equal(res.body.total, res.body.data.length);
  return res.body.data.map((client: Client) => client.id);
};

describe('/api/clients', () => {
  describe('GET /', () => {
    it('lists every client, newest first', async () => {
      assert.deepEqual(await listIds(''), CLIENTS_NEWEST_FIRST);
    });

    it('filters on search, status and planId', async () => {
      assert.deepEqual(await listIds('?search=%20Okafor%20'), [CLIENT_IDS.daniel]);
      assert.deepEqual(await listIds('?status=churned'), [CLIENT_IDS.hannah]);
      assert.deepEqual(await listIds(`?planId=${PLAN_IDS.enterprise}`), [CLIENT_IDS.kenji]);
      assert.deepEqual(await listIds('?planId=none'), [CLIENT_IDS.hannah]);
    });

    it('treats a blank search as no search', async () => {
      assert.deepEqual(await listIds('?search=%20%20'), CLIENTS_NEWEST_FIRST);
    });

    const invalid: [string, string][] = [
      ['an unknown status', '?status=deleted'],
      ['a repeated parameter', '?status=active&status=trial'],
      ['a planId that is neither a UUID nor none', '?planId=pro'],
      ['a search over 100 characters', `?search=${'a'.repeat(101)}`],
    ];
    for (const [name, query] of invalid) {
      it(`rejects ${name}`, async () => {
        await request(app).get(`/api/clients${query}`).expect(400);
      });
    }
  });

  describe('GET /:id', () => {
    it('returns a client', async () => {
      const res = await request(app).get(`/api/clients/${CLIENT_IDS.olivia}`).expect(200);
      assert.equal(res.body.data.email, 'olivia.bennett@northwind.io');
    });

    it('rejects an id that is not a UUID', async () => {
      const res = await request(app).get('/api/clients/olivia').expect(400);
      assert.deepEqual(res.body.details, { id: ['Client id must be a UUID'] });
    });

    it('answers 404 for an unknown client', async () => {
      const res = await request(app).get(`/api/clients/${UNKNOWN_ID}`).expect(404);
      assert.deepEqual(res.body, { error: 'Not Found', message: 'Client not found' });
    });
  });

  describe('PATCH /:id', () => {
    it('attaches a plan, then detaches it with null', async () => {
      const attached = await request(app)
        .patch(`/api/clients/${CLIENT_IDS.hannah}`)
        .send({ planId: PLAN_IDS.lite })
        .expect(200);
      assert.equal(attached.body.data.planId, PLAN_IDS.lite);

      const detached = await request(app)
        .patch(`/api/clients/${CLIENT_IDS.hannah}`)
        .send({ planId: null })
        .expect(200);
      assert.equal(detached.body.data.planId, null);
    });

    it('answers 400 on planId for an unknown plan', async () => {
      const res = await request(app)
        .patch(`/api/clients/${CLIENT_IDS.olivia}`)
        .send({ planId: UNKNOWN_ID })
        .expect(400);
      assert.deepEqual(res.body, {
        error: 'Bad Request',
        message: 'Plan not found',
        details: { planId: ['Plan not found'] },
      });
    });

    it('answers 409 for an archived plan', async () => {
      const res = await request(app)
        .patch(`/api/clients/${CLIENT_IDS.olivia}`)
        .send({ planId: PLAN_IDS.starter })
        .expect(409);
      assert.deepEqual(Object.keys(res.body.details), ['planId']);
    });

    it('accepts re-sending the archived plan a client already has', async () => {
      const before = await request(app).get(`/api/clients/${CLIENT_IDS.sofia}`).expect(200);
      const res = await request(app)
        .patch(`/api/clients/${CLIENT_IDS.sofia}`)
        .send({ planId: PLAN_IDS.starter })
        .expect(200);
      assert.deepEqual(res.body.data, before.body.data);
    });

    it('rejects any field but planId', async () => {
      const res = await request(app)
        .patch(`/api/clients/${CLIENT_IDS.olivia}`)
        .send({ planId: null, status: 'churned' })
        .expect(400);
      assert.match(res.body.message, /Unrecognized key: "status"/);
    });

    it('requires planId', async () => {
      const res = await request(app)
        .patch(`/api/clients/${CLIENT_IDS.olivia}`)
        .send({})
        .expect(400);
      assert.deepEqual(Object.keys(res.body.details), ['planId']);
    });

    it('answers 404 for an unknown client', async () => {
      await request(app).patch(`/api/clients/${UNKNOWN_ID}`).send({ planId: null }).expect(404);
    });
  });
});

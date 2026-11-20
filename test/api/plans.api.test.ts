import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';
import type { Plan } from '../../src/api/feature/plan/plan.schema.ts';
import { loadApp } from '../helpers/env.ts';
import { PLAN_IDS, UNKNOWN_ID, uniquePlanCode } from '../helpers/fixtures.ts';

const app = await loadApp();

const newPlanBody = (overrides: Record<string, unknown> = {}) => ({
  code: uniquePlanCode(),
  name: 'API test plan',
  currency: 'USD',
  prices: { monthly: 2500, yearly: 25000 },
  ...overrides,
});

const createPlan = async (overrides: Record<string, unknown> = {}): Promise<Plan> =>
  (await request(app).post('/api/plans').send(newPlanBody(overrides)).expect(201)).body.data;

describe('/api/plans', () => {
  describe('GET /', () => {
    it('lists plans with their total', async () => {
      const res = await request(app).get('/api/plans').expect(200);
      assert.equal(res.body.total, res.body.data.length);
      assert.equal(res.body.data[0].id, PLAN_IDS.lite);
    });

    it('filters on archived', async () => {
      const archived = await request(app).get('/api/plans?archived=true').expect(200);
      assert.ok(archived.body.data.every((plan: Plan) => plan.archived));

      const active = await request(app).get('/api/plans?archived=false').expect(200);
      assert.ok(active.body.data.every((plan: Plan) => !plan.archived));
    });

    it('rejects an archived value other than true or false', async () => {
      const res = await request(app).get('/api/plans?archived=yes').expect(400);
      assert.deepEqual(Object.keys(res.body.details), ['archived']);
    });

    it('ignores unknown query keys', async () => {
      await request(app).get('/api/plans?sort=name').expect(200);
    });
  });

  describe('GET /:id', () => {
    it('returns a plan', async () => {
      const res = await request(app).get(`/api/plans/${PLAN_IDS.pro}`).expect(200);
      assert.equal(res.body.data.code, 'pro');
    });

    it('rejects an id that is not a UUID', async () => {
      const res = await request(app).get('/api/plans/pro').expect(400);
      assert.deepEqual(res.body.details, { id: ['Plan id must be a UUID'] });
    });

    it('answers 404 for an unknown plan', async () => {
      const res = await request(app).get(`/api/plans/${UNKNOWN_ID}`).expect(404);
      assert.deepEqual(res.body, { error: 'Not Found', message: 'Plan not found' });
    });
  });

  describe('POST /', () => {
    it('creates a plan, defaulting the description', async () => {
      const body = newPlanBody();
      const res = await request(app).post('/api/plans').send(body).expect(201);

      const plan: Plan = res.body.data;
      assert.equal(res.headers['location'], `/api/plans/${plan.id}`);
      assert.equal(plan.code, body.code);
      assert.equal(plan.description, '');
      assert.equal(plan.archived, false);

      await request(app).get(`/api/plans/${plan.id}`).expect(200);
    });

    it('accepts custom pricing (both prices null)', async () => {
      const plan = await createPlan({ prices: { monthly: null, yearly: null } });
      assert.deepEqual(plan.prices, { monthly: null, yearly: null });
    });

    const invalid: [string, Record<string, unknown>, string][] = [
      ['a currency other than USD', { currency: 'EUR' }, 'currency'],
      ['only one price', { prices: { monthly: 100, yearly: null } }, 'prices'],
      ['a price that is not whole cents', { prices: { monthly: 19.99, yearly: 199 } }, 'prices'],
      ['a negative price', { prices: { monthly: -1, yearly: 0 } }, 'prices'],
      ['a code with capitals and spaces', { code: 'Pro Plan' }, 'code'],
      ['a blank name', { name: '   ' }, 'name'],
    ];
    for (const [name, overrides, field] of invalid) {
      it(`rejects ${name}`, async () => {
        const res = await request(app).post('/api/plans').send(newPlanBody(overrides)).expect(400);
        assert.deepEqual(Object.keys(res.body.details), [field]);
      });
    }

    it('rejects an unknown key instead of dropping it', async () => {
      const res = await request(app)
        .post('/api/plans')
        .send(newPlanBody({ price: 100 }))
        .expect(400);
      assert.match(res.body.message, /Unrecognized key: "price"/);
    });

    it('rejects server-set fields', async () => {
      const res = await request(app)
        .post('/api/plans')
        .send(newPlanBody({ archived: true }))
        .expect(400);
      assert.match(res.body.message, /Unrecognized key/);
    });

    it('rejects a body that is not an object', async () => {
      const res = await request(app).post('/api/plans').send([newPlanBody()]).expect(400);
      assert.ok(res.body.message);
    });

    it('answers 409 for a code already in use', async () => {
      const res = await request(app)
        .post('/api/plans')
        .send(newPlanBody({ code: 'lite' }))
        .expect(409);
      assert.deepEqual(res.body, {
        error: 'Conflict',
        message: 'Plan code "lite" is already in use',
        details: { code: ['Plan code "lite" is already in use'] },
      });
    });
  });

  describe('PATCH /:id', () => {
    it('updates the given fields only', async () => {
      const plan = await createPlan({ description: 'Before' });

      const res = await request(app)
        .patch(`/api/plans/${plan.id}`)
        .send({ name: 'Renamed', archived: true })
        .expect(200);

      assert.equal(res.body.data.name, 'Renamed');
      assert.equal(res.body.data.archived, true);
      assert.equal(res.body.data.description, 'Before');
      assert.deepEqual(res.body.data.prices, plan.prices);
    });

    it('replaces prices whole', async () => {
      const plan = await createPlan();
      const res = await request(app)
        .patch(`/api/plans/${plan.id}`)
        .send({ prices: { monthly: null, yearly: null } })
        .expect(200);
      assert.deepEqual(res.body.data.prices, { monthly: null, yearly: null });
    });

    it('rejects an empty body with a message', async () => {
      const res = await request(app).patch(`/api/plans/${PLAN_IDS.pro}`).send({}).expect(400);
      assert.equal(res.body.message, 'Request body must include at least one field to update');
      assert.deepEqual(res.body.details, {});
    });

    it('rejects a code change with only the unknown-key error', async () => {
      const res = await request(app)
        .patch(`/api/plans/${PLAN_IDS.pro}`)
        .send({ code: 'pro-2' })
        .expect(400);
      assert.match(res.body.message, /Unrecognized key: "code"/);
      assert.doesNotMatch(res.body.message, /at least one field/);
    });

    it('answers 404 for an unknown plan', async () => {
      await request(app).patch(`/api/plans/${UNKNOWN_ID}`).send({ name: 'x' }).expect(404);
    });

    it('validates the id before the body', async () => {
      const res = await request(app).patch('/api/plans/not-a-uuid').send({}).expect(400);
      assert.deepEqual(Object.keys(res.body.details), ['id']);
    });
  });
});

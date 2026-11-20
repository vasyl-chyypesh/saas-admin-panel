import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CreatePlanInput } from '../../../../src/api/feature/plan/plan.schema.ts';
import * as planService from '../../../../src/api/feature/plan/plan.service.ts';
import { PLAN_IDS, UNKNOWN_ID, uniquePlanCode } from '../../../helpers/fixtures.ts';

/**
 * The storage is shared by every test in this file, so tests create plans with unique codes and
 * check the mock plans by id rather than counting the whole list.
 */
const newPlanInput = (overrides: Partial<CreatePlanInput> = {}): CreatePlanInput => ({
  code: uniquePlanCode(),
  name: 'Test plan',
  description: '',
  currency: 'USD',
  prices: { monthly: 1000, yearly: 10000 },
  ...overrides,
});

const MOCK_IDS = new Set<string>(Object.values(PLAN_IDS));

describe('plan.service', () => {
  describe('listPlans', () => {
    it('puts active plans first, cheapest first, custom pricing last', () => {
      const ids = planService
        .listPlans({})
        .map((plan) => plan.id)
        .filter((id) => MOCK_IDS.has(id));
      assert.deepEqual(ids, [PLAN_IDS.lite, PLAN_IDS.pro, PLAN_IDS.enterprise, PLAN_IDS.starter]);
    });

    it('orders plans with the same (or no) price by name', () => {
      const zeta = planService.createPlan(
        newPlanInput({ name: 'Zeta', prices: { monthly: null, yearly: null } }),
      );
      const alpha = planService.createPlan(
        newPlanInput({ name: 'Alpha', prices: { monthly: null, yearly: null } }),
      );

      const ids = planService.listPlans({ archived: false }).map((plan) => plan.id);
      // Enterprise has custom pricing too, and sorts between them by name.
      assert.ok(ids.indexOf(alpha.id) < ids.indexOf(PLAN_IDS.enterprise));
      assert.ok(ids.indexOf(PLAN_IDS.enterprise) < ids.indexOf(zeta.id));
      assert.ok(ids.indexOf(PLAN_IDS.pro) < ids.indexOf(alpha.id));
    });

    it('filters on archived', () => {
      const archived = planService.listPlans({ archived: true });
      assert.ok(archived.length > 0);
      assert.ok(archived.every((plan) => plan.archived));
      assert.ok(archived.some((plan) => plan.id === PLAN_IDS.starter));

      assert.ok(planService.listPlans({ archived: false }).every((plan) => !plan.archived));
    });
  });

  describe('getPlan / findPlan', () => {
    it('returns a known plan', () => {
      assert.equal(planService.getPlan(PLAN_IDS.pro).code, 'pro');
      assert.equal(planService.findPlan(PLAN_IDS.pro)?.code, 'pro');
    });

    it('getPlan throws not-found and findPlan returns undefined for an unknown id', () => {
      assert.throws(() => planService.getPlan(UNKNOWN_ID), {
        name: 'AppError',
        kind: 'not-found',
        message: 'Plan not found',
      });
      assert.equal(planService.findPlan(UNKNOWN_ID), undefined);
    });
  });

  describe('createPlan', () => {
    it('creates an active plan with server-set fields', () => {
      const input = newPlanInput({ description: 'For tests' });
      const plan = planService.createPlan(input);

      assert.match(plan.id, /^[0-9a-f-]{36}$/);
      assert.equal(plan.archived, false);
      assert.equal(plan.createdAt, plan.updatedAt);
      assert.equal(plan.code, input.code);
      assert.equal(plan.description, 'For tests');
      assert.deepEqual(planService.getPlan(plan.id), plan);
    });

    it('rejects a code that is already taken, blaming code', () => {
      assert.throws(() => planService.createPlan(newPlanInput({ code: 'pro' })), {
        kind: 'conflict',
        field: 'code',
        message: 'Plan code "pro" is already in use',
      });
    });

    it('counts archived plans when checking the code', () => {
      assert.throws(() => planService.createPlan(newPlanInput({ code: 'starter-2024' })), {
        kind: 'conflict',
      });
    });
  });

  describe('updatePlan', () => {
    it('merges the changes, replaces prices whole and bumps updatedAt', (t) => {
      const plan = planService.createPlan(newPlanInput({ name: 'Before' }));
      t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-01-02T03:04:05.000Z') });

      const updated = planService.updatePlan(plan.id, {
        name: 'After',
        prices: { monthly: null, yearly: null },
        archived: true,
      });

      assert.deepEqual(updated, {
        ...plan,
        name: 'After',
        prices: { monthly: null, yearly: null },
        archived: true,
        updatedAt: '2030-01-02T03:04:05.000Z',
      });
      assert.deepEqual(planService.getPlan(plan.id), updated);
    });

    it('throws not-found for an unknown id', () => {
      assert.throws(() => planService.updatePlan(UNKNOWN_ID, { name: 'x' }), {
        kind: 'not-found',
      });
    });
  });
});

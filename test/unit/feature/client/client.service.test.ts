import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as clientService from '../../../../src/api/feature/client/client.service.ts';
import {
  CLIENT_IDS,
  CLIENTS_NEWEST_FIRST,
  PLAN_IDS,
  UNKNOWN_ID,
} from '../../../helpers/fixtures.ts';

const ids = (clients: { id: string }[]) => clients.map((client) => client.id);

describe('client.service', () => {
  describe('listClients', () => {
    it('lists every client, newest first', () => {
      assert.deepEqual(ids(clientService.listClients({})), CLIENTS_NEWEST_FIRST);
    });

    it('searches name and email case-insensitively', () => {
      assert.deepEqual(ids(clientService.listClients({ search: 'MARCUS' })), [CLIENT_IDS.marcus]);
      assert.deepEqual(ids(clientService.listClients({ search: 'northwind.io' })), [
        CLIENT_IDS.olivia,
      ]);
      assert.deepEqual(clientService.listClients({ search: 'nobody-matches' }), []);
    });

    it('does not search the company', () => {
      // Olivia's company is "Northwind Analytics"; "analytics" is in neither her name nor email.
      assert.deepEqual(clientService.listClients({ search: 'Analytics' }), []);
    });

    it('filters on status', () => {
      assert.deepEqual(ids(clientService.listClients({ status: 'trial' })), [
        CLIENT_IDS.priya,
        CLIENT_IDS.marcus,
      ]);
    });

    it('filters on planId, with "none" meaning no plan', () => {
      assert.deepEqual(ids(clientService.listClients({ planId: PLAN_IDS.pro })), [
        CLIENT_IDS.priya,
        CLIENT_IDS.daniel,
        CLIENT_IDS.olivia,
      ]);
      assert.deepEqual(ids(clientService.listClients({ planId: 'none' })), [CLIENT_IDS.hannah]);
    });

    it('combines filters', () => {
      assert.deepEqual(
        ids(clientService.listClients({ planId: PLAN_IDS.pro, status: 'active', search: 'o' })),
        [CLIENT_IDS.olivia],
      );
    });
  });

  describe('getClient / findClient', () => {
    it('returns a known client', () => {
      assert.equal(clientService.getClient(CLIENT_IDS.olivia).name, 'Olivia Bennett');
      assert.equal(clientService.findClient(CLIENT_IDS.olivia)?.name, 'Olivia Bennett');
    });

    it('getClient throws not-found and findClient returns undefined for an unknown id', () => {
      assert.throws(() => clientService.getClient(UNKNOWN_ID), {
        kind: 'not-found',
        message: 'Client not found',
      });
      assert.equal(clientService.findClient(UNKNOWN_ID), undefined);
    });
  });

  describe('setPlan', () => {
    it('attaches a plan and detaches it with null, bumping updatedAt', (t) => {
      t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-01-01T00:00:00.000Z') });

      const attached = clientService.setPlan(CLIENT_IDS.hannah, PLAN_IDS.lite);
      assert.equal(attached.planId, PLAN_IDS.lite);
      assert.equal(attached.updatedAt, '2030-01-01T00:00:00.000Z');
      assert.deepEqual(clientService.getClient(CLIENT_IDS.hannah), attached);

      const detached = clientService.setPlan(CLIENT_IDS.hannah, null);
      assert.equal(detached.planId, null);
      assert.deepEqual(ids(clientService.listClients({ planId: 'none' })), [CLIENT_IDS.hannah]);
    });

    it('treats re-sending the current plan as a no-op', () => {
      const before = clientService.getClient(CLIENT_IDS.olivia);
      assert.equal(clientService.setPlan(CLIENT_IDS.olivia, PLAN_IDS.pro), before);
    });

    it('lets a client keep the archived plan it already has', () => {
      const before = clientService.getClient(CLIENT_IDS.sofia);
      assert.equal(clientService.setPlan(CLIENT_IDS.sofia, PLAN_IDS.starter), before);
    });

    it('rejects an unknown plan as invalid input on planId', () => {
      assert.throws(() => clientService.setPlan(CLIENT_IDS.olivia, UNKNOWN_ID), {
        kind: 'invalid',
        field: 'planId',
        message: 'Plan not found',
      });
    });

    it('refuses to attach an archived plan', () => {
      assert.throws(() => clientService.setPlan(CLIENT_IDS.olivia, PLAN_IDS.starter), {
        kind: 'conflict',
        field: 'planId',
        message: 'Plan "Starter (2024)" is archived and cannot be attached',
      });
      assert.equal(clientService.getClient(CLIENT_IDS.olivia).planId, PLAN_IDS.pro);
    });

    it('throws not-found for an unknown client before looking at the plan', () => {
      assert.throws(() => clientService.setPlan(UNKNOWN_ID, UNKNOWN_ID), { kind: 'not-found' });
    });
  });
});

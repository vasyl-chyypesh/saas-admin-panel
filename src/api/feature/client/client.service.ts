import { AppError } from '../../lib/errors.ts';
import * as planService from '../plan/plan.service.ts';
import type { Client, ListClientsQuery } from './client.schema.ts';
import * as clientStorage from './client.storage.ts';

/**
 * Client rules. Takes parsed input and returns records; failures are thrown as `AppError`. Other
 * features use clients only through this module, never through `client.storage.ts`.
 */

export const listClients = (query: ListClientsQuery): Client[] => clientStorage.listClients(query);

/** For other features checking a client they were given; `undefined` when it does not exist. */
export const findClient = (id: string): Client | undefined => clientStorage.getClientById(id);

export const getClient = (id: string): Client => {
  const client = clientStorage.getClientById(id);
  if (!client) throw new AppError('not-found', 'Client not found');
  return client;
};

/**
 * Attaches a plan, or detaches it with `null`. An unknown plan is bad input (400) and an archived
 * one a conflict (409), both blamed on `planId`. Re-sending the current plan is a no-op, which also
 * lets a client keep an archived plan.
 */
export const setPlan = (id: string, planId: string | null): Client => {
  const client = getClient(id);
  if (planId === client.planId) return client;

  if (planId !== null) {
    const plan = planService.findPlan(planId);
    if (!plan) throw new AppError('invalid', 'Plan not found', { field: 'planId' });
    if (plan.archived) {
      throw new AppError('conflict', `Plan "${plan.name}" is archived and cannot be attached`, {
        field: 'planId',
      });
    }
  }

  const updated = clientStorage.setClientPlan(client.id, planId);
  // `getClient` just found it and nothing in between can remove it, so this cannot happen.
  if (!updated) throw new Error(`Client ${client.id} vanished while its plan was being set`);
  return updated;
};

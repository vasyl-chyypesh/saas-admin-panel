import { getPlanById } from '../plan/plan.storage.ts';
import { type Client, clientSchema, type ListClientsQuery } from './client.schema.ts';

/**
 * In-memory mock data until a real database exists. Parsed at import so a typo fails at boot.
 * Writes change this array, so they last until the process restarts.
 */
const clients: Client[] = clientSchema.array().parse([
  {
    id: '38fabbe4-f262-445e-9e5f-ff5dc49744ca',
    name: 'Olivia Bennett',
    email: 'olivia.bennett@northwind.io',
    company: 'Northwind Analytics',
    status: 'active',
    planId: 'c1e964af-952e-49cb-b6fe-4eeab545542b',
    createdAt: '2025-03-14T09:21:00.000Z',
    updatedAt: '2026-10-02T16:45:00.000Z',
  },
  {
    id: '57cf7641-1b0a-4f11-aad4-ecf08de2e7e7',
    name: 'Marcus Lee',
    email: 'marcus@brightpath.dev',
    company: 'BrightPath Labs',
    status: 'trial',
    planId: '4d5e4056-7b48-40e1-b9a8-ac89742caf67',
    createdAt: '2026-11-05T13:02:00.000Z',
    updatedAt: '2026-11-12T08:10:00.000Z',
  },
  {
    id: '37cf297c-e2ce-44cb-b71b-6aaf8064ecd0',
    name: 'Sofia Martínez',
    email: 'sofia.martinez@lumencraft.com',
    company: 'Lumencraft',
    status: 'active',
    planId: '7adb0946-f786-4434-bdf1-221b0a104fff',
    createdAt: '2024-11-28T17:40:00.000Z',
    updatedAt: '2026-09-19T11:05:00.000Z',
  },
  {
    id: '2f3321b1-841e-4aba-a2e8-91af0e14d524',
    name: 'Daniel Okafor',
    email: 'd.okafor@harborfreight.co',
    company: 'Harbor Freight Co.',
    status: 'suspended',
    planId: 'c1e964af-952e-49cb-b6fe-4eeab545542b',
    createdAt: '2025-07-02T07:15:00.000Z',
    updatedAt: '2026-08-30T19:22:00.000Z',
  },
  {
    id: 'd06722fe-69bd-4436-bb51-515a480c739f',
    name: 'Hannah Schmidt',
    email: 'hannah@quillstack.de',
    company: 'Quillstack GmbH',
    status: 'churned',
    planId: null,
    createdAt: '2024-06-10T10:00:00.000Z',
    updatedAt: '2026-02-14T14:30:00.000Z',
  },
  {
    id: '8f98eb0a-45e9-48a2-86c7-a06ebfa4b4b3',
    name: 'Kenji Watanabe',
    email: 'kenji.watanabe@orbitly.jp',
    company: 'Orbitly',
    status: 'active',
    planId: '854148f1-0ab5-4a53-a56a-1d2fa4d43cc1',
    createdAt: '2025-12-01T02:48:00.000Z',
    updatedAt: '2026-11-18T05:12:00.000Z',
  },
  {
    id: 'a5c0395d-1df2-4309-987a-db86dd4560ea',
    name: 'Priya Raman',
    email: 'priya.raman@greenleafhealth.org',
    company: 'Greenleaf Health',
    status: 'trial',
    planId: 'c1e964af-952e-49cb-b6fe-4eeab545542b',
    createdAt: '2026-11-15T15:30:00.000Z',
    updatedAt: '2026-11-15T15:30:00.000Z',
  },
]);

// A mock planId that points nowhere is bad mock data too, so it fails at boot as well.
for (const client of clients) {
  if (client.planId !== null && !getPlanById(client.planId)) {
    throw new Error(`Mock client ${client.id} references unknown plan ${client.planId}`);
  }
}

/** Newest first. `search` matches name or email, case-insensitively. `planId: 'none'` = no plan. */
export const listClients = ({ search, status, planId }: ListClientsQuery = {}): Client[] => {
  const needle = search?.toLowerCase();

  return clients
    .filter((client) => status === undefined || client.status === status)
    .filter(
      (client) => planId === undefined || client.planId === (planId === 'none' ? null : planId),
    )
    .filter(
      (client) =>
        needle === undefined ||
        client.name.toLowerCase().includes(needle) ||
        client.email.toLowerCase().includes(needle),
    )
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
};

export const getClientById = (id: string): Client | undefined =>
  clients.find((client) => client.id === id);

/**
 * Attaches a plan (or detaches with `null`) and bumps `updatedAt`. Returns `undefined` for an
 * unknown client. Checking that the plan exists and may be attached is the caller's job.
 */
export const setClientPlan = (id: string, planId: string | null): Client | undefined => {
  const index = clients.findIndex((client) => client.id === id);
  const current = clients[index];
  if (!current) return undefined;

  const updated: Client = { ...current, planId, updatedAt: new Date().toISOString() };
  clients[index] = updated;
  return updated;
};

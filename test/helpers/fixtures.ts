import { randomUUID } from 'node:crypto';
import type { Client } from '../../src/api/feature/client/client.schema.ts';

/** A plan code no other test uses, within the 40-character limit. */
export const uniquePlanCode = (): string => `test-${randomUUID().slice(0, 13)}`;

/** IDs of the mock plans in `plan.storage.ts`. */
export const PLAN_IDS = {
  lite: '4d5e4056-7b48-40e1-b9a8-ac89742caf67',
  pro: 'c1e964af-952e-49cb-b6fe-4eeab545542b',
  enterprise: '854148f1-0ab5-4a53-a56a-1d2fa4d43cc1',
  /** The only archived mock plan. */
  starter: '7adb0946-f786-4434-bdf1-221b0a104fff',
} as const;

/** IDs of the mock clients in `client.storage.ts`, with their mock plan in the comment. */
export const CLIENT_IDS = {
  /** pro, active */
  olivia: '38fabbe4-f262-445e-9e5f-ff5dc49744ca',
  /** lite, trial */
  marcus: '57cf7641-1b0a-4f11-aad4-ecf08de2e7e7',
  /** starter (archived), active */
  sofia: '37cf297c-e2ce-44cb-b71b-6aaf8064ecd0',
  /** pro, suspended */
  daniel: '2f3321b1-841e-4aba-a2e8-91af0e14d524',
  /** no plan, churned */
  hannah: 'd06722fe-69bd-4436-bb51-515a480c739f',
  /** enterprise, active */
  kenji: '8f98eb0a-45e9-48a2-86c7-a06ebfa4b4b3',
  /** pro, trial */
  priya: 'a5c0395d-1df2-4309-987a-db86dd4560ea',
} as const;

/** Mock clients, newest `createdAt` first: the order every client list comes back in. */
export const CLIENTS_NEWEST_FIRST = [
  CLIENT_IDS.priya,
  CLIENT_IDS.marcus,
  CLIENT_IDS.kenji,
  CLIENT_IDS.daniel,
  CLIENT_IDS.olivia,
  CLIENT_IDS.sofia,
  CLIENT_IDS.hannah,
];

/** A well-formed v4 UUID that matches no record. */
export const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

/** The mock client Olivia, as stored. */
export const OLIVIA: Client = {
  id: CLIENT_IDS.olivia,
  name: 'Olivia Bennett',
  email: 'olivia.bennett@northwind.io',
  company: 'Northwind Analytics',
  status: 'active',
  planId: PLAN_IDS.pro,
  createdAt: '2025-03-14T09:21:00.000Z',
  updatedAt: '2026-10-02T16:45:00.000Z',
};

import type { JSX } from 'react';
// Type-only import: erased at build, so zod never reaches the UI bundle.
import type {
  Client,
  ClientStatus,
  UpdateClientBody,
} from '../../../api/feature/client/client.schema.ts';

export type { Client, ClientStatus, UpdateClientBody };

export interface ClientListResponse {
  data: Client[];
  total: number;
}

export interface ClientResponse {
  data: Client;
}

/** Typed as a Record so adding a status on the API side fails typecheck here until labelled. */
export const clientStatusLabels: Record<ClientStatus, string> = {
  active: 'Active',
  trial: 'Trial',
  suspended: 'Suspended',
  churned: 'Churned',
};

export const isClientStatus = (value: string): value is ClientStatus =>
  Object.hasOwn(clientStatusLabels, value);

export const StatusBadge = ({ status }: { status: ClientStatus }): JSX.Element => (
  <span className={`status status--${status}`}>{clientStatusLabels[status]}</span>
);

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export const formatDate = (iso: string): string => dateFormat.format(new Date(iso));
export const formatDateTime = (iso: string): string => dateTimeFormat.format(new Date(iso));

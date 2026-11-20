import { z } from 'zod';

export const clientStatusSchema = z.enum(['active', 'trial', 'suspended', 'churned']);

export const clientSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  email: z.email(),
  company: z.string().min(1),
  status: clientStatusSchema,
  /** The client's plan, or `null` when none is attached. */
  planId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/** `GET /api/clients/:id`, `PATCH /api/clients/:id` */
export const clientIdParamsSchema = z.object({
  id: z.uuid({ message: 'Client id must be a UUID' }),
});

/**
 * `GET /api/clients?search=&status=&planId=`. All are optional; `planId=none` matches clients with
 * no plan. Express's default query parser can
 * produce arrays (`?status=a&status=b`); `z.string()` rejects those with a 400 rather than
 * guessing which value was meant. Unknown keys are stripped, not rejected.
 */
export const listClientsQuerySchema = z.object({
  search: z
    .string()
    .trim()
    .max(100)
    .transform((value) => (value === '' ? undefined : value))
    .optional(),
  status: clientStatusSchema.optional(),
  planId: z.union([z.uuid(), z.literal('none')]).optional(),
});

/**
 * `PATCH /api/clients/:id`. Only the plan can change for now: `null` detaches it. Strict, so an
 * attempt to change another field is a 400 rather than a silent no-op.
 */
export const updateClientSchema = z.strictObject({
  planId: z.uuid().nullable(),
});

export type ClientStatus = z.infer<typeof clientStatusSchema>;
export type Client = z.infer<typeof clientSchema>;
export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;
export type UpdateClientBody = z.input<typeof updateClientSchema>;

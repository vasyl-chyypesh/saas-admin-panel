import { z } from 'zod';

/**
 * Amount in the currency's minor unit (cents for USD). `null` means the price is not published and
 * the plan is sold through sales ("contact us"). The cap keeps amounts far from float precision.
 */
const priceSchema = z.int().nonnegative().max(100_000_000).nullable();

/** Both prices published, or both `null` (custom pricing). A half-custom plan has no meaning. */
export const planPricesSchema = z
  .strictObject({
    monthly: priceSchema,
    yearly: priceSchema,
  })
  .refine((prices) => (prices.monthly === null) === (prices.yearly === null), {
    message: 'Set both prices, or neither for custom pricing',
  });

const planCodeSchema = z
  .string()
  .max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Use lowercase letters, digits and single hyphens',
  });
const planNameSchema = z.string().trim().min(1).max(60);
const planDescriptionSchema = z.string().trim().max(500);
/**
 * Plans are invoiced through Oncade, which bills in USD only, so a plan in any other currency
 * could never be invoiced. See `src/api/feature/invoice/oncade-invoices.md`.
 */
const currencySchema = z.literal('USD', { message: 'Only USD is supported' });

export const planSchema = z.object({
  id: z.uuid(),
  /** Stable handle such as `pro`. Unique, and fixed once the plan exists. */
  code: planCodeSchema,
  name: planNameSchema,
  description: planDescriptionSchema,
  currency: currencySchema,
  prices: planPricesSchema,
  /** Archived plans stay on the clients that have them but cannot be newly attached. */
  archived: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

/** `GET /api/plans/:id`, `PATCH /api/plans/:id` */
export const planIdParamsSchema = z.object({
  id: z.uuid({ message: 'Plan id must be a UUID' }),
});

/** `GET /api/plans?archived=true|false`. Omitted means all plans. */
export const listPlansQuerySchema = z.object({
  archived: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

/**
 * `POST /api/plans`. Bodies are strict: an unknown key (say, a typo like `price`) is a 400 rather
 * than being silently dropped. The server sets `id`, `archived` and the timestamps.
 */
export const createPlanSchema = z.strictObject({
  code: planCodeSchema,
  name: planNameSchema,
  description: planDescriptionSchema.default(''),
  currency: currencySchema,
  prices: planPricesSchema,
});

/**
 * `PATCH /api/plans/:id`. Every field is optional, but an empty body is a 400. `prices` is replaced
 * as a whole. `code` is deliberately absent, because it cannot change. `currency` is accepted so the
 * form can send the whole draft, but it can only be `USD`, so it never changes.
 */
export const updatePlanSchema = z
  .strictObject({
    name: planNameSchema.optional(),
    description: planDescriptionSchema.optional(),
    currency: currencySchema.optional(),
    prices: planPricesSchema.optional(),
    archived: z.boolean().optional(),
  })
  // No `path`, so the message lands in the response's `message` rather than in `details`. `when`
  // keeps it to otherwise valid bodies: an unknown key is a continuable issue, so without it
  // `{ "code": "x" }` would get this message on top of "Unrecognized key".
  .refine((changes) => Object.keys(changes).length > 0, {
    message: 'Request body must include at least one field to update',
    when: (payload) => payload.issues.length === 0,
  });

export type Plan = z.infer<typeof planSchema>;
export type PlanPrices = z.infer<typeof planPricesSchema>;
export type ListPlansQuery = z.infer<typeof listPlansQuerySchema>;
export type CreatePlanInput = z.output<typeof createPlanSchema>;
export type UpdatePlanInput = z.output<typeof updatePlanSchema>;
/** Request bodies as the UI sends them. */
export type CreatePlanBody = z.input<typeof createPlanSchema>;
export type UpdatePlanBody = z.input<typeof updatePlanSchema>;

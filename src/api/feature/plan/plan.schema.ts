import { z } from 'zod';

/**
 * Amount in the currency's minor unit (cents for USD). `null` means the price is not published and
 * the plan is sold through sales ("contact us"). The cap keeps amounts far from float precision.
 */
const priceSchema = z.int().nonnegative().max(100_000_000).nullable();

export const planPricesSchema = z.strictObject({
  monthly: priceSchema,
  yearly: priceSchema,
});

const planCodeSchema = z
  .string()
  .max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Use lowercase letters, digits and single hyphens',
  });
const planNameSchema = z.string().trim().min(1).max(60);
const planDescriptionSchema = z.string().trim().max(500);
const currencySchema = z.string().regex(/^[A-Z]{3}$/, {
  message: 'Use a three-letter ISO 4217 code, e.g. USD',
});

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
 * `PATCH /api/plans/:id`. Every field is optional, but the router rejects an empty body. `prices` is
 * replaced as a whole. `code` is deliberately absent, because it cannot change.
 */
export const updatePlanSchema = z.strictObject({
  name: planNameSchema.optional(),
  description: planDescriptionSchema.optional(),
  currency: currencySchema.optional(),
  prices: planPricesSchema.optional(),
  archived: z.boolean().optional(),
});

export type Plan = z.infer<typeof planSchema>;
export type PlanPrices = z.infer<typeof planPricesSchema>;
export type ListPlansQuery = z.infer<typeof listPlansQuerySchema>;
export type CreatePlanInput = z.output<typeof createPlanSchema>;
export type UpdatePlanInput = z.output<typeof updatePlanSchema>;
/** Request bodies as the UI sends them. */
export type CreatePlanBody = z.input<typeof createPlanSchema>;
export type UpdatePlanBody = z.input<typeof updatePlanSchema>;

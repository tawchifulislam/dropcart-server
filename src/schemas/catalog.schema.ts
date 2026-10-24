import { z } from 'zod';

export const productInput = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().min(1).max(2000),
  category: z.string().trim().min(1).max(50),
  images: z.array(z.url()).max(8).default([]),
  variants: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(50),
        sku: z.string().trim().max(50).optional(),
      }),
    )
    .default([]),
  specs: z.record(z.string(), z.string()).default({}),
  basePrice: z.number().int().min(0),
});

export const dropInput = z
  .object({
    productId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid product id'),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    dropPrice: z.number().int().min(0),
    stockTotal: z.number().int().min(1).max(100000),
  })
  .refine((value) => value.endsAt > value.startsAt, {
    path: ['endsAt'],
    message: 'endsAt must be after startsAt',
  });

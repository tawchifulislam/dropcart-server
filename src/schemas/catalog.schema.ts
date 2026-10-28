import { z } from 'zod';

const imageSource = z
  .string()
  .trim()
  .refine(
    (value) => value.startsWith('/') || URL.canParse(value),
    'Use a full URL or a path starting with /',
  );

export const productInput = z.object({
  name: z
    .string({ error: 'Enter a name' })
    .trim()
    .min(2, 'Use at least 2 characters')
    .max(120, 'Use at most 120 characters'),
  description: z
    .string({ error: 'Enter a description' })
    .trim()
    .min(1, 'Enter a description')
    .max(2000, 'Use at most 2000 characters'),
  category: z
    .string({ error: 'Enter a category' })
    .trim()
    .min(1, 'Enter a category')
    .max(50, 'Use at most 50 characters'),
  images: z.array(imageSource).max(8, 'Add at most 8 images').default([]),
  variants: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(50),
        sku: z.string().trim().max(50).optional(),
      }),
    )
    .max(20, 'Add at most 20 options')
    .default([]),
  specs: z.record(z.string(), z.string()).default({}),
  basePrice: z
    .number({ error: 'Enter a price' })
    .int('Use a whole number')
    .min(0, 'Price cannot be negative'),
});

export const dropInput = z
  .object({
    productId: z
      .string({ error: 'Choose a product' })
      .regex(/^[a-f\d]{24}$/i, 'Choose a product'),
    startsAt: z.coerce.date({ error: 'Enter a valid start time' }),
    endsAt: z.coerce.date({ error: 'Enter a valid end time' }),
    dropPrice: z
      .number({ error: 'Enter a drop price' })
      .int('Use a whole number')
      .min(0, 'Price cannot be negative'),
    stockTotal: z
      .number({ error: 'Enter the number of units' })
      .int('Use a whole number')
      .min(1, 'A drop needs at least 1 unit')
      .max(100000, 'Use at most 100000 units'),
  })
  .refine((value) => value.endsAt > value.startsAt, {
    path: ['endsAt'],
    message: 'The end must be after the start',
  });

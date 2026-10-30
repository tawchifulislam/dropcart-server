import 'dotenv/config';
import { z } from 'zod';

const schema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().default(4000),
    MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
    MONGODB_DB: z.string().trim().min(1).default('dropcart'),
    CLIENT_ORIGIN: z.string().default('http://localhost:3000'),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
    RESERVATION_TTL_SECONDS: z.coerce.number().int().min(10).default(300),
    PAYMENT_PROVIDER: z.enum(['stripe', 'mock']).default('mock'),
    PAYMENT_CURRENCY: z.string().length(3).toLowerCase().default('bdt'),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().default('gemini-3.5-flash'),
    DEMO_MODE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    DEMO_RESET_TOKEN: z
      .string()
      .min(24, 'DEMO_RESET_TOKEN must be at least 24 characters')
      .optional(),
  })
  .refine(
    (value) =>
      value.PAYMENT_PROVIDER !== 'stripe' ||
      Boolean(value.STRIPE_SECRET_KEY && value.STRIPE_WEBHOOK_SECRET),
    {
      path: ['STRIPE_SECRET_KEY'],
      message:
        'STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required when PAYMENT_PROVIDER=stripe',
    },
  )
  .refine(
    (value) =>
      value.NODE_ENV !== 'production' ||
      value.CLIENT_ORIGIN.startsWith('https://'),
    {
      path: ['CLIENT_ORIGIN'],
      message: 'CLIENT_ORIGIN must be an https URL in production',
    },
  )
  .refine((value) => !value.DEMO_MODE || Boolean(value.DEMO_RESET_TOKEN), {
    path: ['DEMO_RESET_TOKEN'],
    message: 'DEMO_RESET_TOKEN is required when DEMO_MODE=true',
  });
const result = schema.safeParse(process.env);

if (!result.success) {
  console.error('Invalid environment variables:');
  console.error(z.prettifyError(result.error));
  process.exit(1);
}

export const env = result.data;

import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().default(4000),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  CLIENT_ORIGIN: z.string().default('http://localhost:3000'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
  RESERVATION_TTL_SECONDS: z.coerce.number().int().min(10).default(300),
});

const result = schema.safeParse(process.env);

if (!result.success) {
  console.error('Invalid environment variables:');
  console.error(z.prettifyError(result.error));
  process.exit(1);
}

export const env = result.data;

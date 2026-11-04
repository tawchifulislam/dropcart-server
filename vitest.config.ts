import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      MONGODB_URI: 'mongodb://127.0.0.1:27017',
      JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
      PAYMENT_PROVIDER: 'mock',
      CLIENT_ORIGIN: 'http://localhost:3000',
      RESERVATION_TTL_SECONDS: '300',
      DEMO_MODE: 'false',
    },
  },
});
